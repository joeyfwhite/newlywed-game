#!/usr/bin/env python3
"""TEST ONLY. A tiny stand-in for Supabase's REST + Auth APIs, backed by the
REAL schema in a local Postgres (via psql). Each request runs as the same
database role Supabase would use (anon or authenticated + JWT claims), so
RLS and function grants are exercised exactly as in production.
Also serves the static site from the repo root.

Usage: python3 tests/mock_supabase.py <port> <dbname>
"""
import json, os, re, subprocess, sys, time, uuid
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import jwt

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
DB = sys.argv[2] if len(sys.argv) > 2 else 'newlywed_e2e'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ANON_KEY = 'test-anon-key'
SECRET = 'test-jwt-secret'
USERS = {  # email -> (password, auth.users id)
    'admin@example.com': ('correct horse battery', '00000000-0000-0000-0000-00000000aaaa'),
    'stranger@example.com': ('stranger password', '00000000-0000-0000-0000-00000000bbbb'),
}
PSQL = ['psql', '-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']


def lit(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    return "'" + str(v).replace("'", "''") + "'"


def run_sql(role, claims, sql):
    full = f"set role {role}; select set_config('request.jwt.claims', {lit(json.dumps(claims) if claims else '')}, false); {sql}"
    p = subprocess.run(PSQL + ['-c', full], capture_output=True, text=True)
    if p.returncode != 0:
        m = re.search(r'ERROR:\s+(.*)', p.stderr)
        raise PgError(m.group(1).strip() if m else p.stderr.strip())
    return p.stdout.strip().split('\n')[-1] if p.stdout.strip() else ''


class PgError(Exception):
    pass


RET_TYPES = {}


def ret_type(fn):
    if fn not in RET_TYPES:
        out = subprocess.run(PSQL + ['-c', f"select prorettype::regtype from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname={lit(fn)}"], capture_output=True, text=True).stdout.strip()
        RET_TYPES[fn] = out
    return RET_TYPES[fn]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def send_json(self, status, obj):
        body = json.dumps(obj).encode() if obj is not None else b'null'
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def who(self):
        if self.headers.get('apikey') != ANON_KEY:
            return None
        tok = (self.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
        if tok == ANON_KEY:
            return ('anon', None)
        try:
            c = jwt.decode(tok, SECRET, algorithms=['HS256'], audience='authenticated')
        except Exception:
            return 'bad'
        return ('authenticated', {'sub': c['sub'], 'role': 'authenticated'})

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}') if n else {}

    def pg_fail(self, role, e):
        msg = str(e)
        if 'permission denied' in msg or msg == 'not_authorized':
            return self.send_json(401 if role == 'anon' else 403, {'code': '42501', 'message': msg})
        return self.send_json(400, {'code': 'P0001', 'message': msg})

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith('/rest/v1/'):
            return super().do_GET()
        w = self.who()
        if w in (None, 'bad'):
            return self.send_json(401, {'message': 'Invalid API key' if w is None else 'JWT expired'})
        table = u.path.split('/')[-1]
        q = parse_qs(u.query)
        cols = q.pop('select', ['*'])[0]
        order = q.pop('order', [None])[0]
        where = []
        for k, v in q.items():
            op, val = v[0].split('.', 1)
            assert op == 'eq'
            where.append(f'{k} = {lit(val)}')
        sql = f"select coalesce(jsonb_agg(t), '[]') from (select {cols} from public.{table}{' where ' + ' and '.join(where) if where else ''}{' order by ' + order if order else ''}) t"
        try:
            return self.send_json(200, json.loads(run_sql(w[0], w[1], sql)))
        except PgError as e:
            return self.pg_fail(w[0], e)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == '/auth/v1/token':
            if self.headers.get('apikey') != ANON_KEY:
                return self.send_json(401, {'message': 'Invalid API key'})
            grant = parse_qs(u.query).get('grant_type', [''])[0]
            b = self.body()
            if grant == 'password':
                rec = USERS.get((b.get('email') or '').lower())
                if not rec or rec[0] != b.get('password'):
                    return self.send_json(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                email, uid = b['email'].lower(), rec[1]
            elif grant == 'refresh_token':
                try:
                    email, uid = b['refresh_token'].split('|')
                except Exception:
                    return self.send_json(400, {'error': 'invalid_grant'})
            else:
                return self.send_json(400, {'error': 'unsupported_grant_type'})
            now = int(time.time())
            tok = jwt.encode({'sub': uid, 'aud': 'authenticated', 'role': 'authenticated', 'exp': now + 3600, 'email': email}, SECRET, algorithm='HS256')
            return self.send_json(200, {'access_token': tok, 'refresh_token': f'{email}|{uid}', 'expires_in': 3600, 'expires_at': now + 3600, 'user': {'id': uid, 'email': email}})
        if u.path == '/auth/v1/logout':
            self.send_response(204); self.end_headers(); return
        if u.path.startswith('/rest/v1/rpc/'):
            w = self.who()
            if w in (None, 'bad'):
                return self.send_json(401, {'message': 'unauthorized'})
            fn = u.path.split('/')[-1]
            if not re.fullmatch(r'[a-z_]+', fn):
                return self.send_json(404, {'message': 'not found'})
            args = ', '.join(f'{k} => {lit(v)}' for k, v in self.body().items())
            rt = ret_type(fn)
            if not rt:
                return self.send_json(404, {'code': 'PGRST202', 'message': 'function not found'})
            try:
                if rt == 'void':
                    run_sql(w[0], w[1], f'select public.{fn}({args})')
                    return self.send_json(200, None)
                out = run_sql(w[0], w[1], f"select coalesce(to_jsonb(public.{fn}({args})), 'null'::jsonb)")
                return self.send_json(200, json.loads(out))
            except PgError as e:
                return self.pg_fail(w[0], e)
        return self.send_json(404, {'message': 'not found'})


if __name__ == '__main__':
    print(f'mock supabase on http://127.0.0.1:{PORT} (db {DB})', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
