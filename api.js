// Small, dependency-free client for the two Supabase APIs this site uses:
// PostgREST (database functions and reads) and GoTrue (admin sign-in).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SESSION_KEY = 'nwg-admin-session';

export function isConfigured() {
  return !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.startsWith('YOUR-');
}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('network', { status: 0 });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = (data && (data.message || data.msg || data.error_description || data.error)) || `HTTP ${res.status}`;
    throw new ApiError(message, { status: res.status, code: data && (data.code || data.error_code), details: data && data.details });
  }
  return data;
}

// ---------------- Parent survey (anonymous, token-based) ----------------

export const survey = {
  get: (token) => request('/rest/v1/rpc/survey_get', { method: 'POST', body: { p_token: token } }),
  save: (token, answers) => request('/rest/v1/rpc/survey_save', { method: 'POST', body: { p_token: token, p_answers: answers } }),
  submit: (token, answers) => request('/rest/v1/rpc/survey_submit', { method: 'POST', body: { p_token: token, p_answers: answers } }),
};

// ---------------- Admin (Supabase Auth session) ----------------

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function storeSession(s) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}
function normalizeSession(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    email: d.user && d.user.email,
  };
}

export const auth = {
  session: loadSession,

  async signIn(email, password) {
    const d = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    const s = normalizeSession(d);
    storeSession(s);
    return s;
  },

  async signOut() {
    const s = loadSession();
    storeSession(null);
    if (s) { try { await request('/auth/v1/logout', { method: 'POST', token: s.access_token }); } catch { /* ignore */ } }
  },

  // Returns a valid access token, refreshing it if it is about to expire.
  async accessToken() {
    let s = loadSession();
    if (!s) throw new ApiError('signed_out', { status: 401 });
    if (s.expires_at - 60 < Date.now() / 1000) {
      try {
        const d = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
        s = { ...normalizeSession(d), email: s.email };
        storeSession(s);
      } catch (e) {
        storeSession(null);
        throw new ApiError('signed_out', { status: 401 });
      }
    }
    return s.access_token;
  },
};

async function adminRequest(path, opts = {}) {
  const token = await auth.accessToken();
  try {
    return await request(path, { ...opts, token });
  } catch (e) {
    if (e.status === 401) { storeSession(null); throw new ApiError('signed_out', { status: 401 }); }
    throw e;
  }
}

const rpc = (fn, args = {}) => adminRequest(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
const select = (table, query) => adminRequest(`/rest/v1/${table}?${query}`);

export const admin = {
  isAdmin: () => rpc('is_admin'),
  generateLink: (role) => rpc('admin_generate_link', { p_role: role }),
  setLocked: (locked) => rpc('admin_set_locked', { p_locked: locked }),
  updateAnswer: (role, questionId, answer) => rpc('admin_update_answer', { p_role: role, p_question_id: questionId, p_answer: answer }),
  resetSurvey: (role) => rpc('admin_reset_survey', { p_role: role }),

  async loadAll() {
    const [questions, participants, answers, settings] = await Promise.all([
      select('questions', 'select=id,prompt&order=id'),
      select('participants', 'select=role,label,link_created_at,started_at,submitted_at,updated_at'),
      select('answers', 'select=role,question_id,answer,updated_at,updated_by'),
      select('app_settings', 'select=locked,locked_at&id=eq.1'),
    ]);
    return { questions, participants, answers, settings: settings[0] || { locked: false } };
  },
};
