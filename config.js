// =====================================================================
// Site configuration. This is the ONLY file you need to edit.
// Both values come from Supabase: Dashboard > Project Settings > API Keys
// (and the Project URL from Project Settings > Data API, or the "Connect" button).
//
// The publishable / anon key is designed to be public. It is safe to
// commit it. NEVER put the "secret" or "service_role" key here.
// =====================================================================

export const SUPABASE_URL = 'https://dfgfdqnkfmqvfvryyzig.supabase.co/rest/v1/';
export const SUPABASE_ANON_KEY = 'sb_publishable_1Avdhb2EW7schstxLGSH9g_Gvh_m9oe';

// Optional personal touches.
export const ORGANIZER_NAME = 'White Family';   // e.g. 'Joey'. Shown as "Questions? Text Joey."
export const COUPLE_NAMES = ' Cinda & Steve';     // e.g. 'Linda & Mike'. Shown on the title slide.
export const ANNIVERSARY_DATE = 'November 2026'; // e.g. 'December 2026'. Shown on the title slide.

// Optional: the public address of the survey page, used when building
// the private links. Leave blank to use the address the admin page is on.
export const SITE_URL = '';
