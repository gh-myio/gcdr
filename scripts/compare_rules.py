import re, json

content = open('logs/004-Rules-check.log', encoding='utf-8').read()

# Split on "depois" as a standalone line (not inside a description)
parts = re.split(r'\n\s*depois\s*\n', content, maxsplit=1)
antes_raw = parts[0]
depois_raw = parts[1] if len(parts) > 1 else ''

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

def parse_rules(text):
    rules = {}
    pat = (r"INSERT INTO rules[^V]*VALUES \('(" + UUID + r")', '"
           + UUID + r"', '" + UUID + r"', '(.+?)', '")
    for m in re.finditer(pat, text):
        rid, name = m.group(1), m.group(2)
        row_end = text.find('ON CONFLICT', m.start())
        row = text[m.start():row_end]
        # scope_entity_ids comes right after the version number
        sei = re.findall(r", (\d+), '(\[.*?\])'::jsonb", row)
        count = len(json.loads(sei[-1][1])) if sei else 0
        rules[rid] = {'name': name.strip(), 'count': count}
    return rules

antes = parse_rules(antes_raw)
depois = parse_rules(depois_raw)

print('%-55s %4s %4s  %s' % ('RULE NAME', 'ANT', 'DEP', 'STATUS'))
print('-' * 80)
for rid in sorted(antes.keys()):
    a = antes[rid]
    d = depois.get(rid)
    name = a['name'][:53]
    ca = a['count']
    if d:
        cd = d['count']
        note = ('  DEVICES CHANGED: %d -> %d' % (ca, cd)) if ca != cd else ''
        print('%-55s %4d %4d  OK%s' % (name, ca, cd, note))
    else:
        print('%-55s %4d %4s  REMOVIDA' % (name, ca, ''))
for rid in sorted(depois.keys()):
    if rid not in antes:
        d = depois[rid]
        print('%-55s %4s %4d  NOVA' % (d['name'][:53], '', d['count']))
print()
print('Total: antes=%d depois=%d' % (len(antes), len(depois)))
