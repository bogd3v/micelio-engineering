#!/usr/bin/env python3
# usage: tok.py <session id> : prints input output cacheRead for a session log
import json,sys,glob,os
f=glob.glob(os.path.expanduser('~/.claude/projects/*/'+sys.argv[1]+'.jsonl'))[0]
i=o=c=0;seen=set()
for l in open(f):
    try:d=json.loads(l)
    except: continue
    m=d.get('message') or {}
    u=m.get('usage') if isinstance(m,dict) else None
    if u and m.get('id') not in seen:
        seen.add(m.get('id'));i+=u.get('input_tokens',0)+u.get('cache_creation_input_tokens',0);o+=u.get('output_tokens',0);c+=u.get('cache_read_input_tokens',0)
print(i,o,c)
