// =============================================================================
// nightly-backup
// =============================================================================
// WHAT THIS IS
//   The company's real backup. Supabase's own backups need a paid plan, keep
//   only 7 days, and never include uploaded files. This function does three
//   things every night, unattended, forever:
//
//     1. Exports every table in schema "public" to one gzipped JSON bundle and
//        stores it in the private "backups" storage bucket.
//     2. Lists every uploaded file in the "documents" and "km-photos" buckets
//        and records them in a manifest inside that same bundle.
//     3. If a private GitHub repo is configured, pushes the bundle AND every
//        uploaded file to that repo, so the data also lives off Supabase.
//
//   Every run writes a row into public.backup_runs so a human can see, in the
//   app, whether last night worked.
//
// WHAT IS DELIBERATELY *NOT* BACKED UP
//   public.list_public_tables() decides what gets exported, and it excludes
//   job_secrets and two_step_codes on purpose. A backup must never carry the
//   credentials that protect it, nor short-lived login codes. If you add
//   another table holding secrets, exclude it there - not here.
//
// RETENTION (who deletes what)
//   - Old rows in backup_runs      -> public.prune_backup_runs()
//   - Old bundles in the bucket    -> THIS function, via the Storage API,
//                                     honouring app_settings.backup_retention_months
//   - Old bundles in GitHub        -> THIS function, via the contents API
//   Uploaded files under backups/files/ are NEVER deleted, by anything.
//
// HOW IT IS CALLED
//   By the database's own scheduler (a pg_cron job named "nightly-backup",
//   running at 20:30 UTC), NOT by a logged-in user. That is why verify_jwt is
//   false: the function authenticates itself instead. The caller must send the
//   header  x-backup-secret  matching the expected secret. There is
//   deliberately no "open" fallback - if the expected secret cannot be
//   resolved, the function refuses to run.
//
// WHERE THE SECRET LIVES  (nothing to set up by hand)
//   The shared secret is stored IN THE DATABASE, not in a dashboard setting:
//
//     public.job_secrets    key = 'nightly-backup', secret = 32-byte random hex
//                           RLS is on with NO policies, so no signed-in user
//                           can read it; only the service-role key can.
//     public.job_secret(p_key text)
//                           SECURITY DEFINER reader. EXECUTE is revoked from
//                           public/anon/authenticated; service_role may call it.
//
//   The cron job reads that row and sends it as the header; this function reads
//   the same row through job_secret() and compares. Both sides therefore share
//   one secret that was generated automatically. NO MANUAL SETUP IS NEEDED -
//   nobody has to open the Supabase dashboard or set an environment variable.
//
//   An optional BACKUP_SECRET environment variable still takes precedence if
//   somebody ever sets one (useful for local testing), but it is not required
//   and is expected to be absent in production.
//
// ENVIRONMENT VARIABLES
//   Auto-provided by Supabase (nothing to do):
//     SUPABASE_URL
//     SUPABASE_SERVICE_ROLE_KEY
//   Optional override:
//     BACKUP_SECRET             overrides the database-held secret if set
//   Optional (off-site copy; without these, uploaded files are NOT protected):
//     GITHUB_BACKUP_TOKEN       PAT with contents:write on the backup repo
//     GITHUB_BACKUP_REPO        "owner/repo"
//
// DESIGN RULES FOLLOWED HERE (please keep them)
//   - Boring, linear, heavily commented. No cleverness.
//   - Only dependency is jsr:@supabase/supabase-js@2.
//   - Never log secrets and never log row contents.
//   - The whole body is wrapped in try/catch so ANY failure still lands in
//     backup_runs and still returns HTTP 200 (a non-200 would make the
//     scheduler retry over and over).
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

// -----------------------------------------------------------------------------
// Tunables. Change these here, nowhere else.
// -----------------------------------------------------------------------------

/** Rows read per request when paging through a table. Keeps memory sane. */
const ROW_BATCH = 1000;

/** Private bucket the gzipped database bundle is written to. */
const BACKUP_BUCKET = "backups";

/** Buckets holding user-uploaded files that must be backed up off-site. */
const FILE_BUCKETS = ["documents", "km-photos"];

/** Branch in the GitHub backup repo. */
const GITHUB_BRANCH = "main";

/**
 * GitHub's contents API rejects very large files. We skip anything bigger and
 * report it rather than failing the whole run.
 */
const MAX_GITHUB_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Cap on how many NEW files we push to GitHub in one night. The push is
 * incremental (files already in the repo are skipped), so the very first run
 * simply spreads itself over a few nights instead of hitting the edge
 * function's execution time limit and achieving nothing.
 */
const MAX_FILES_PER_RUN = 200;

/** Database bundles older than this many months are deleted from GitHub. */
const RETENTION_MONTHS = 12;

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/**
 * Today's date in Asia/Kolkata, as string parts. The business is in India, so
 * "which day is this backup for" must be decided in Indian time, not UTC.
 * "en-CA" formats as YYYY-MM-DD, which is exactly what we want.
 */
function kolkataDateParts(when: Date): { year: string; month: string; day: string; iso: string } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  const [year, month, day] = formatted.split("-");
  return { year, month, day, iso: formatted };
}

/**
 * Constant-time secret comparison. We deliberately do NOT use === : that stops
 * at the first differing character, so an attacker could measure response times
 * and guess the secret one character at a time. Instead we walk every byte and
 * XOR-accumulate the differences, so the work done is the same whether the
 * secret is wrong in the first byte or the last.
 */
function secretsMatch(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  // Length is not secret (it is fixed for our secrets), so an early exit here
  // leaks nothing useful, and it keeps the loop below a simple equal-length walk.
  if (bytesA.length !== bytesB.length) return false;
  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
  return difference === 0;
}

/**
 * Read every row of one table, in batches, so a big table never blows memory.
 *
 * Preferred strategy is keyset pagination on "id": order by id and ask for the
 * rows after the last id we saw. That is steady even if rows change mid-run.
 *
 * Not every table has an "id" column though (public.job_secrets is keyed by
 * "key"), so if the very first ordered read fails we fall back to plain offset
 * paging, which works on any table. Returns the rows plus an error string if
 * the table could not be read at all.
 */
async function fetchAllRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tableName: string,
): Promise<{ rows: unknown[]; error: string | null }> {
  // --- Attempt 1: keyset pagination on "id" ---------------------------------
  const rows: unknown[] = [];
  let lastId: unknown = null;

  while (true) {
    let query = supabase.from(tableName).select("*").order("id", { ascending: true }).limit(
      ROW_BATCH,
    );
    if (lastId !== null) query = query.gt("id", lastId);

    const { data: batch, error } = await query;

    if (error) {
      // Failed on the very first read: most likely there is no "id" column.
      // Try the generic offset strategy instead before giving up.
      if (rows.length === 0) break;
      return { rows, error: error.message };
    }
    if (!batch || batch.length === 0) return { rows, error: null };

    for (const row of batch) rows.push(row);
    if (batch.length < ROW_BATCH) return { rows, error: null };
    lastId = (batch[batch.length - 1] as Record<string, unknown>).id;
  }

  // --- Attempt 2: offset paging (works with or without an "id" column) ------
  const fallbackRows: unknown[] = [];
  let offset = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from(tableName)
      .select("*")
      .range(offset, offset + ROW_BATCH - 1);

    if (error) return { rows: fallbackRows, error: error.message };
    if (!batch || batch.length === 0) return { rows: fallbackRows, error: null };

    for (const row of batch) fallbackRows.push(row);
    if (batch.length < ROW_BATCH) return { rows: fallbackRows, error: null };
    offset += batch.length;
  }
}

/** Gzip a byte array using the runtime's built-in CompressionStream. */
async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/**
 * Base64-encode raw bytes. Done in chunks because passing a whole multi-MB
 * array to String.fromCharCode(...) blows the call stack. This is binary-safe,
 * which matters: most uploaded files are photos and PDFs, not text.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32 KB per chunk
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Percent-encode each path segment (spaces, #, ? in filenames are common). */
function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Standard JSON response. Always 200 unless stated otherwise. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// GitHub contents API wrapper
// -----------------------------------------------------------------------------

interface GitHubConfig {
  repo: string; // "owner/repo"
  token: string;
}

/** One call to https://api.github.com/repos/{repo}/contents/{path}. */
async function githubContents(
  cfg: GitHubConfig,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  query = "",
): Promise<{ status: number; json: any }> {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${encodeRepoPath(path)}${query}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ref-erp-nightly-backup",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // 404 is a normal, expected answer ("file not there yet"), so it is not an
  // error here. The caller decides what each status means.
  let parsed: any = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, json: parsed };
}

/** True if the path already exists in the repo (so we can skip re-uploading). */
async function githubFileExists(cfg: GitHubConfig, path: string): Promise<boolean> {
  const res = await githubContents(cfg, "GET", path, undefined, `?ref=${GITHUB_BRANCH}`);
  return res.status === 200;
}

/**
 * Create or replace a file in the repo. Returns the resulting commit sha.
 * If the path already exists we must send its blob sha, otherwise GitHub
 * rejects the write with 409/422.
 */
async function githubPutFile(
  cfg: GitHubConfig,
  path: string,
  contentBytes: Uint8Array,
  message: string,
): Promise<string | null> {
  // Look up the existing blob sha (needed only when overwriting).
  let existingSha: string | undefined;
  const existing = await githubContents(cfg, "GET", path, undefined, `?ref=${GITHUB_BRANCH}`);
  if (existing.status === 200 && existing.json && typeof existing.json.sha === "string") {
    existingSha = existing.json.sha;
  }

  const res = await githubContents(cfg, "PUT", path, {
    message,
    content: bytesToBase64(contentBytes),
    branch: GITHUB_BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  if (res.status !== 200 && res.status !== 201) {
    // Deliberately include only GitHub's own message, never the token.
    throw new Error(
      `GitHub PUT ${path} failed with ${res.status}: ${res.json?.message ?? "unknown error"}`,
    );
  }
  return res.json?.commit?.sha ?? null;
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ---------------------------------------------------------------------------
  // Step 1a - Is there a secret header at all? No header, no conversation.
  // ---------------------------------------------------------------------------
  const providedSecret = req.headers.get("x-backup-secret") ?? "";
  if (!providedSecret) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  // ---------------------------------------------------------------------------
  // Step 1b - Build the Supabase admin client.
  //
  // This has to happen BEFORE the secret check now, because the expected secret
  // normally lives in the database and we need this client to read it. The
  // service-role key bypasses row level security, which is what lets it read
  // public.job_secrets (RLS on, no policies) and, later, every table.
  // ---------------------------------------------------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing." },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Project ref is the first label of the Supabase hostname. Recorded in the
  // bundle so a restorer knows which project the data came from.
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

  // ---------------------------------------------------------------------------
  // Step 1c - Work out what the secret SHOULD be.
  //
  // Order: the BACKUP_SECRET environment variable wins if somebody set one
  // (handy for local testing), otherwise we read the real one from the database
  // via public.job_secret('nightly-backup'). In production the env var is
  // absent and the database is the single source of truth, so the owner never
  // has to configure anything by hand.
  // ---------------------------------------------------------------------------
  let expectedSecret = Deno.env.get("BACKUP_SECRET") ?? "";

  if (!expectedSecret) {
    try {
      const { data: dbSecret, error: secretError } = await supabase.rpc("job_secret", {
        p_key: "nightly-backup",
      });
      if (secretError) throw new Error(secretError.message);
      if (typeof dbSecret === "string") expectedSecret = dbSecret;
    } catch (secretLookupError) {
      // Note: the message below describes the failure, never the secret itself.
      return jsonResponse(
        {
          ok: false,
          error:
            "Could not read the backup secret from the database " +
            "(public.job_secret('nightly-backup')): " +
            (secretLookupError instanceof Error
              ? secretLookupError.message
              : String(secretLookupError)),
        },
        500,
      );
    }
  }

  // Step 1d - Still nothing? Refuse. We never fall through to open access.
  if (!expectedSecret) {
    return jsonResponse(
      {
        ok: false,
        error:
          "No backup secret is configured. Expected a row with key 'nightly-backup' in " +
          "public.job_secrets (or a BACKUP_SECRET environment variable). The nightly " +
          "backup will not run without one.",
      },
      500,
    );
  }

  // Step 1e - Constant-time comparison, so the secret cannot be probed by timing.
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  // Optional GitHub configuration. Both values must be present to be usable.
  const githubToken = Deno.env.get("GITHUB_BACKUP_TOKEN") ?? "";
  const githubRepo = Deno.env.get("GITHUB_BACKUP_REPO") ?? "";
  const github: GitHubConfig | null =
    githubToken && githubRepo ? { repo: githubRepo, token: githubToken } : null;

  // Values reported at the end; also written to backup_runs.
  let runId: string | null = null;
  let tablesExported = 0;
  let totalRows = 0;
  let filesManifested = 0;
  let filesPushed = 0;
  let filesSkippedTooLarge = 0;
  let filesDeferred = 0;
  let bytesWritten = 0;
  let commitSha: string | null = null;
  let bundlePath = "";
  const warnings: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Step 2 - Open the run row. Everything after this point is recorded.
    // -------------------------------------------------------------------------
    const startedAt = new Date();
    const { data: runRow, error: runError } = await supabase
      .from("backup_runs")
      .insert({ status: "draft", started_at: startedAt.toISOString() })
      .select("id")
      .single();

    if (runError) throw new Error(`Could not open backup_runs row: ${runError.message}`);
    runId = runRow.id as string;

    // -------------------------------------------------------------------------
    // Step 3 - Export every base table in schema public.
    //
    // The table list is discovered at runtime via the SQL helper
    // public.list_public_tables(), so a table added to the ERP next year is
    // backed up automatically without anyone editing this file.
    // -------------------------------------------------------------------------
    const { data: tableRows, error: tableListError } = await supabase.rpc("list_public_tables");
    if (tableListError) {
      throw new Error(`Could not list public tables: ${tableListError.message}`);
    }

    // The RPC returns [{ table_name: "..." }, ...].
    const tableNames: string[] = (tableRows ?? [])
      .map((r: any) => r.table_name as string)
      .filter((name: string) => typeof name === "string" && name.length > 0);

    const tables: Record<string, unknown[]> = {};
    /** Tables we could not read. A partial backup is still saved, but the run
     *  is marked cancelled so it never looks like a clean success. */
    const tableErrors: string[] = [];

    for (const tableName of tableNames) {
      const { rows, error: readError } = await fetchAllRows(supabase, tableName);

      if (readError) {
        // Record and move on: losing one table must not cost us all the others.
        tableErrors.push(`${tableName}: ${readError}`);
        continue;
      }

      tables[tableName] = rows;
      tablesExported += 1;
      totalRows += rows.length;
    }

    // -------------------------------------------------------------------------
    // Step 4 - Inventory the uploaded files.
    //
    // storage.list() is not recursive, so we walk the folder tree ourselves.
    // An entry with id === null is a folder; anything else is a real object.
    // The manifest goes INTO the bundle, so even when GitHub is not configured
    // we at least have a dated record of which files existed.
    // -------------------------------------------------------------------------
    interface ManifestEntry {
      bucket: string;
      path: string;
      size: number | null;
      mime: string | null;
      etag: string | null;
      last_modified: string | null;
    }
    const storageManifest: ManifestEntry[] = [];

    for (const bucket of FILE_BUCKETS) {
      // Breadth-first walk of the bucket's folders.
      const foldersToVisit: string[] = [""];

      while (foldersToVisit.length > 0) {
        const prefix = foldersToVisit.shift() as string;
        let offset = 0;

        while (true) {
          const { data: entries, error: listError } = await supabase.storage
            .from(bucket)
            .list(prefix, {
              limit: ROW_BATCH,
              offset,
              sortBy: { column: "name", order: "asc" },
            });

          if (listError) {
            warnings.push(`Could not list bucket "${bucket}" at "${prefix}": ${listError.message}`);
            break;
          }
          if (!entries || entries.length === 0) break;

          for (const entry of entries) {
            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.id === null) {
              foldersToVisit.push(fullPath); // it is a folder, descend later
            } else {
              const meta = (entry.metadata ?? {}) as Record<string, unknown>;
              storageManifest.push({
                bucket,
                path: fullPath,
                size: typeof meta.size === "number" ? meta.size : null,
                mime: typeof meta.mimetype === "string" ? meta.mimetype : null,
                etag: typeof meta.eTag === "string" ? meta.eTag : null,
                last_modified: entry.updated_at ?? (meta.lastModified as string) ?? null,
              });
            }
          }

          if (entries.length < ROW_BATCH) break;
          offset += entries.length;
        }
      }
    }
    filesManifested = storageManifest.length;

    // -------------------------------------------------------------------------
    // Step 5 - Build and compress the bundle, then upload it to storage.
    // -------------------------------------------------------------------------
    const { year, month, iso } = kolkataDateParts(startedAt);

    const bundle = {
      generated_at: startedAt.toISOString(),
      project_ref: projectRef,
      tables,
      storage_manifest: storageManifest,
    };

    const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
    const gzippedBundle = await gzipBytes(bundleBytes);
    bytesWritten = gzippedBundle.byteLength;

    // Path: db/<YYYY>/<MM>/db-<YYYY-MM-DD>.json.gz  (dates in Asia/Kolkata)
    bundlePath = `db/${year}/${month}/db-${iso}.json.gz`;

    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(bundlePath, gzippedBundle, {
        contentType: "application/gzip",
        upsert: true, // re-running on the same day replaces, never fails
      });
    if (uploadError) throw new Error(`Uploading bundle to storage failed: ${uploadError.message}`);

    // -------------------------------------------------------------------------
    // Step 6 - Off-site copy to the private GitHub repo (optional).
    // -------------------------------------------------------------------------
    let destination: "storage" | "both" = "storage";

    if (github) {
      destination = "both";

      // 6a. The database bundle. Always overwritten for the same day.
      commitSha = await githubPutFile(
        github,
        `backups/db/${year}/${month}/db-${iso}.json.gz`,
        gzippedBundle,
        `nightly-backup: database bundle ${iso}`,
      );

      // 6b. Uploaded files, incrementally. A file already in the repo is
      //     skipped after a single cheap GET, which is what keeps this fast
      //     and cheap on every night after the first.
      for (const item of storageManifest) {
        if (filesPushed >= MAX_FILES_PER_RUN) {
          filesDeferred += 1;
          continue;
        }

        const repoPath = `backups/files/${item.bucket}/${item.path}`;

        if (await githubFileExists(github, repoPath)) continue; // already safe

        if (item.size !== null && item.size > MAX_GITHUB_FILE_BYTES) {
          filesSkippedTooLarge += 1;
          warnings.push(`File too large for GitHub, not copied off-site: ${item.bucket}/${item.path}`);
          continue;
        }

        const { data: blob, error: downloadError } = await supabase.storage
          .from(item.bucket)
          .download(item.path);
        if (downloadError || !blob) {
          warnings.push(
            `Could not download ${item.bucket}/${item.path}: ${downloadError?.message ?? "no data"}`,
          );
          continue;
        }

        const fileBytes = new Uint8Array(await blob.arrayBuffer());
        const sha = await githubPutFile(
          github,
          repoPath,
          fileBytes,
          `nightly-backup: file ${item.bucket}/${item.path}`,
        );
        if (sha) commitSha = sha;
        filesPushed += 1;
      }

      if (filesDeferred > 0) {
        warnings.push(
          `${filesDeferred} file(s) not copied tonight (per-run limit of ${MAX_FILES_PER_RUN}); ` +
            `they will be picked up on following nights.`,
        );
      }
    } else {
      // This is the important case. Without the repo, the database is backed
      // up but the uploaded files exist in exactly one place. Say so plainly:
      // it must never read as a clean success.
      warnings.push(
        "UPLOADED FILES ARE NOT YET BACKED UP OFF-SITE: the private backup repository " +
          "is not configured. Set GITHUB_BACKUP_TOKEN and GITHUB_BACKUP_REPO on this " +
          "function so photos and documents are copied somewhere other than Supabase. " +
          "Until then, only the database is protected off-site.",
      );
    }

    // -------------------------------------------------------------------------
    // Step 7 - Retention.
    // -------------------------------------------------------------------------
    // 7a. The log side: age out old rows in backup_runs. This SQL function no
    //     longer touches storage (that is our job now, in 7b). A failure here
    //     is housekeeping and must not fail the backup itself.
    const { error: pruneError } = await supabase.rpc("prune_backup_runs");
    if (pruneError) warnings.push(`prune_backup_runs() failed: ${pruneError.message}`);

    // -------------------------------------------------------------------------
    // 7b. The stored bundles: delete anything under db/ older than the
    //     retention window, through the Storage API.
    //
    //     This has to go through the Storage API - deleting rows straight out
    //     of storage.objects is blocked by the database and leaves the actual
    //     files orphaned behind anyway.
    //
    //     SAFETY: every path we build starts with "db/", and we only ever pass
    //     paths we discovered by walking db/ itself. Nothing outside db/ can be
    //     reached from here, so the uploaded-file backups can never be touched.
    // -------------------------------------------------------------------------
    try {
      // How many months to keep. Configurable in the app; 12 if unset.
      let retentionMonths = RETENTION_MONTHS;
      const { data: settings } = await supabase
        .from("app_settings")
        .select("backup_retention_months")
        .eq("id", 1)
        .maybeSingle();
      if (settings && typeof settings.backup_retention_months === "number") {
        retentionMonths = settings.backup_retention_months;
      }

      // Anything in a month folder before this "YYYY-MM" key is too old.
      const storageCutoff = new Date(startedAt);
      storageCutoff.setUTCMonth(storageCutoff.getUTCMonth() - retentionMonths);
      const cutoffParts = kolkataDateParts(storageCutoff);
      const cutoffKey = `${cutoffParts.year}-${cutoffParts.month}`;

      const expiredPaths: string[] = [];

      // db/ -> year folders
      const { data: yearEntries } = await supabase.storage.from(BACKUP_BUCKET).list("db", {
        limit: ROW_BATCH,
        sortBy: { column: "name", order: "asc" },
      });

      for (const yearEntry of yearEntries ?? []) {
        if (yearEntry.id !== null) continue; // folders only

        // db/<YYYY>/ -> month folders
        const { data: monthEntries } = await supabase.storage
          .from(BACKUP_BUCKET)
          .list(`db/${yearEntry.name}`, {
            limit: ROW_BATCH,
            sortBy: { column: "name", order: "asc" },
          });

        for (const monthEntry of monthEntries ?? []) {
          if (monthEntry.id !== null) continue;
          // Still inside the retention window - keep the whole month.
          if (`${yearEntry.name}-${monthEntry.name}` >= cutoffKey) continue;

          // db/<YYYY>/<MM>/ -> the bundles themselves
          const { data: bundleEntries } = await supabase.storage
            .from(BACKUP_BUCKET)
            .list(`db/${yearEntry.name}/${monthEntry.name}`, {
              limit: ROW_BATCH,
              sortBy: { column: "name", order: "asc" },
            });

          for (const bundleEntry of bundleEntries ?? []) {
            if (bundleEntry.id === null) continue; // real files only
            expiredPaths.push(`db/${yearEntry.name}/${monthEntry.name}/${bundleEntry.name}`);
          }
        }
      }

      if (expiredPaths.length > 0) {
        const { error: removeError } = await supabase.storage
          .from(BACKUP_BUCKET)
          .remove(expiredPaths);
        if (removeError) {
          warnings.push(`Could not delete expired bundles: ${removeError.message}`);
        }
      }
    } catch (storageRetentionError) {
      warnings.push(
        `Storage retention pass failed: ${
          storageRetentionError instanceof Error
            ? storageRetentionError.message
            : String(storageRetentionError)
        }`,
      );
    }

    // 7c. GitHub-side: delete database bundles older than RETENTION_MONTHS.
    //     We NEVER touch backups/files/ - uploaded files are kept forever.
    if (github) {
      try {
        // Cutoff as a comparable "YYYY-MM" string.
        const cutoff = new Date(startedAt);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
        const cutoffParts = kolkataDateParts(cutoff);
        const cutoffKey = `${cutoffParts.year}-${cutoffParts.month}`;

        const yearsRes = await githubContents(
          github,
          "GET",
          "backups/db",
          undefined,
          `?ref=${GITHUB_BRANCH}`,
        );
        if (yearsRes.status === 200 && Array.isArray(yearsRes.json)) {
          for (const yearDir of yearsRes.json) {
            if (yearDir.type !== "dir") continue;

            const monthsRes = await githubContents(
              github,
              "GET",
              `backups/db/${yearDir.name}`,
              undefined,
              `?ref=${GITHUB_BRANCH}`,
            );
            if (monthsRes.status !== 200 || !Array.isArray(monthsRes.json)) continue;

            for (const monthDir of monthsRes.json) {
              if (monthDir.type !== "dir") continue;
              if (`${yearDir.name}-${monthDir.name}` >= cutoffKey) continue; // recent enough

              const filesRes = await githubContents(
                github,
                "GET",
                `backups/db/${yearDir.name}/${monthDir.name}`,
                undefined,
                `?ref=${GITHUB_BRANCH}`,
              );
              if (filesRes.status !== 200 || !Array.isArray(filesRes.json)) continue;

              for (const oldFile of filesRes.json) {
                if (oldFile.type !== "file") continue;
                await githubContents(
                  github,
                  "DELETE",
                  `backups/db/${yearDir.name}/${monthDir.name}/${oldFile.name}`,
                  {
                    message: `nightly-backup: retention, remove ${oldFile.name}`,
                    sha: oldFile.sha,
                    branch: GITHUB_BRANCH,
                  },
                );
              }
            }
          }
        }
      } catch (retentionError) {
        // Retention is housekeeping. It must never turn a good backup into a
        // failed one.
        warnings.push(
          `GitHub retention pass failed: ${
            retentionError instanceof Error ? retentionError.message : String(retentionError)
          }`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Step 8 - Close the run row and answer.
    // -------------------------------------------------------------------------
    // A run that could not read some tables is NOT a success, even though we
    // saved everything else. Mark it cancelled so it shows up as a problem.
    const hadTableErrors = tableErrors.length > 0;
    const finalStatus = hadTableErrors ? "cancelled" : "completed";

    const messageParts: string[] = [];
    if (hadTableErrors) {
      messageParts.push(
        `PARTIAL BACKUP - these tables could not be read: ${tableErrors.join("; ")}`,
      );
    }
    messageParts.push(...warnings);
    const errorMessage = messageParts.length > 0 ? messageParts.join(" | ") : null;

    await supabase
      .from("backup_runs")
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        destination,
        tables_count: tablesExported,
        rows_count: totalRows,
        files_count: filesManifested,
        bytes_written: bytesWritten,
        github_commit: commitSha,
        error_message: errorMessage,
      })
      .eq("id", runId);

    return jsonResponse({
      ok: !hadTableErrors,
      run_id: runId,
      status: finalStatus,
      destination,
      bundle_path: bundlePath,
      bytes_written: bytesWritten,
      tables_exported: tablesExported,
      total_rows: totalRows,
      files_manifested: filesManifested,
      files_pushed: filesPushed,
      files_deferred_to_next_run: filesDeferred,
      files_skipped_too_large: filesSkippedTooLarge,
      github_commit: commitSha,
      error: errorMessage,
    });
  } catch (caught) {
    // -------------------------------------------------------------------------
    // Anything unexpected lands here. Record it against the run row if we got
    // far enough to create one, then still return 200 so the scheduler does not
    // hammer this function in a retry storm. The failure is visible in
    // backup_runs, which is where a human will look.
    // -------------------------------------------------------------------------
    const message = caught instanceof Error ? caught.message : String(caught);

    if (runId) {
      try {
        await supabase
          .from("backup_runs")
          .update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            tables_count: tablesExported,
            rows_count: totalRows,
            files_count: filesManifested,
            bytes_written: bytesWritten,
            github_commit: commitSha,
            error_message: [message, ...warnings].join(" | ").slice(0, 4000),
          })
          .eq("id", runId);
      } catch {
        // If even the update fails there is nothing sensible left to do.
      }
    }

    return jsonResponse({
      ok: false,
      run_id: runId,
      status: "cancelled",
      tables_exported: tablesExported,
      total_rows: totalRows,
      files_manifested: filesManifested,
      files_pushed: filesPushed,
      error: message,
    });
  }
});
