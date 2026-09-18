# Runbook: Foto de infra de um container (Dokploy → Terminal)

- **Onde roda:** dentro do terminal web que o Dokploy abre para cada
  container (Application/Service → aba **Terminal**), ou via `docker exec`
  no host se você tiver SSH na EC2.
- **Objetivo:** coletar CPU, memória, disco, uptime e load do processo/
  container em ~2 minutos, sem instalar nada.
- **Por que isso não é trivial:** a maioria das imagens do Dokploy aqui é
  `node:XX-slim`/`alpine` ou `postgres:16`. Não vem `htop`, `top` quase
  sempre falta `-b` (modo batch, sem TTY interativo), e `free`/`df` podem
  não existir na imagem `alpine`. Todo comando abaixo tem um fallback via
  `/proc` que funciona mesmo num shell `sh` puro sem nenhum pacote extra.
- **Snapshots capturados:** ver [`snapshots/`](./snapshots/) — um `.json`
  versionado por captura, formato descrito na seção 9.

## TL;DR — mínimo viável (comece aqui)

Três comandos, cobrem CPU, memória, load e disco. Testados neste ambiente
(Alpine/busybox, containers `gcdr-backend-api` e `gcdr-frontend`, 2026-09-17):

```sh
top -bn1 | head -8              # memória + CPU% + load average, tudo de uma vez
df -h | grep -vE "tmpfs|shm$"   # disco (raiz + volumes reais, sem pseudo-fs)
uptime                          # uptime do host + load average (1/5/15 min)
```

`head -8` (não `-6`): no container `gcdr-frontend` (nginx), `head -6` cortou
a tabela de processos antes da linha do PID 1 (master), mostrando só os
workers — `-8` garante ao menos 2-3 linhas de processo mesmo quando o PID 1
não é o primeiro a aparecer.

Se `top` não existir na imagem, use os fallbacks das seções 1b/2b/4b
(tudo via `/proc`, funciona em qualquer `sh`). Para o mergulho completo
(cgroup, limites, processo por processo, rede, fd), siga as seções 1-7.

> **Nota entre containers do mesmo host:** `Mem:`/`CPU:`/`Load average:`
> do busybox `top` refletem a **VM inteira** (host Docker), não só o
> container onde você rodou o comando — confirmado comparando os snapshots
> `gcdr-backend-api` e `gcdr-frontend` capturados a 46s de diferença: os
> números de memória batem quase exatamente entre os dois, mesmo sendo
> processos completamente diferentes (`node` vs `nginx`). Para o consumo
> real **deste** container específico, use as seções 2c (memória, cgroup)
> e 1d (CPU, cgroup) — não a linha `Mem:`/`CPU:` do `top`.

## 0. Descobrir o que você tem

```sh
# shell disponível
which bash sh 2>/dev/null
# distro/base da imagem
cat /etc/os-release 2>/dev/null || cat /etc/alpine-release 2>/dev/null
# ferramentas clássicas presentes?
for c in top htop free df du ps uptime vmstat iostat; do
  command -v "$c" >/dev/null 2>&1 && echo "OK  $c" || echo "--  $c (ausente)"
done
```

Se `bash` não existir, troque `bash` por `sh` no cabeçalho dos comandos
abaixo — todos são POSIX-compatíveis, nenhum usa sintaxe bash-only.

> **Validado em container real (2026-09-17), Alpine 3.23, só `/bin/sh`
> (busybox, sem bash):** `top`, `free`, `df`, `du`, `ps`, `uptime`, `iostat`
> presentes; `htop`, `vmstat` ausentes. **Cuidado:** as versões busybox
> desses comandos aceitam menos flags que as versões GNU/procps que a
> maioria dos exemplos na internet assume — em especial o `ps`, ver nota na
> seção 1c. Quando `iostat` aparece como presente, normalmente é porque o
> pacote `sysstat` foi instalado à parte na imagem (não é padrão do
> busybox) — não assuma que está disponível em todo container só porque
> apareceu neste.

## 1. CPU

### 1a. Com `top` (quando existe, modo batch — funciona sem TTY)

```sh
top -bn1 | head -20
```

No busybox `top`, a primeira tela já traz `Mem:`, `CPU:` (usr/sys/nice/idle/
io/irq/sirq) e `Load average:` — muitas vezes isso sozinho já responde CPU +
memória + load (é a base da seção TL;DR acima).

### 1b. Sem `top` — direto do `/proc` (sempre funciona)

```sh
# nº de CPUs visíveis ao container (já respeita cgroup cpuset/cpu.max)
nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo

# % de uso agregado, amostrado em 1s (delta de /proc/stat)
# IMPORTANTE: rode as duas linhas juntas, de uma vez só. Se você rodar só a
# segunda linha de novo depois (sem re-executar a primeira), os números saem
# sem sentido (>100%, valores incoerentes) porque u1/t1 ficam desatualizados
# em relação ao tempo real decorrido — foi exatamente o que aconteceu no
# snapshot manual de 2026-09-17 (ver snapshots/2026-09-17-gcdr-backend-api.json).
set -- $(awk '{print $2+$3+$4, $2+$3+$4+$5+$6+$7+$8}' /proc/stat); u1=$1; t1=$2
sleep 1
awk -v u1=$u1 -v t1=$t1 \
  '{u2=$2+$3+$4; t2=$2+$3+$4+$5+$6+$7+$8; printf "CPU usada: %.1f%%\n", (u2-u1)*100/(t2-t1)}' /proc/stat
```

### 1c. CPU do processo principal do container (PID 1)

```sh
cat /proc/1/status | grep -E "^(Name|VmRSS|Threads)"
cat /proc/1/stat
```

> **Nota busybox/Alpine:** `ps -o pid,ppid,%cpu,%mem,etime,cmd` (colunas
> customizadas com `%cpu`/`%mem`) é o formato GNU/procps — o `ps` do
> busybox aceita `-o` mas normalmente **não** calcula `%cpu`/`%mem` (a
> opção falha ou volta em branco/zero). No busybox use `ps` sem `-o`
> (formato fixo: `PID USER TIME COMMAND`) ou `ps w` para ver a linha de
> comando completa:
> ```sh
> ps | grep -E "^\s*1\s"
> ps w | head -5
> ```

### 1d. Limite/quota de CPU que o Docker/Dokploy impôs (cgroup)

```sh
# cgroup v2 (mais comum hoje)
cat /sys/fs/cgroup/cpu.max 2>/dev/null
# cgroup v1 (fallback)
cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null
```
`max 100000` ou quota `-1` = sem limite de CPU setado nesse container.

## 2. Memória

### 2a. Com `free` (Debian/Ubuntu-based, geralmente presente)

```sh
free -h
```

### 2b. Sem `free` — `/proc/meminfo` (sempre funciona, inclusive Alpine)

```sh
awk '/MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree/ {printf "%-15s %8.1f MB\n", $1, $2/1024}' /proc/meminfo
```

### 2c. Memória do container segundo o cgroup (o número que importa pro OOM)

```sh
# cgroup v2
echo "uso atual:"; cat /sys/fs/cgroup/memory.current 2>/dev/null | awk '{printf "%.1f MB\n", $1/1024/1024}'
echo "limite:";    cat /sys/fs/cgroup/memory.max     2>/dev/null
# cgroup v1 (fallback)
echo "uso atual:"; cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null | awk '{printf "%.1f MB\n", $1/1024/1024}'
echo "limite:";    cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null | awk '{printf "%.1f MB\n", $1/1024/1024}'
```
Se o limite aparecer como um número gigante tipo `9223372036854771712`
(v1) ou `max` (v2), o container não tem limite de memória configurado no
Dokploy — é o total da VM que vale.

### 2d. Memória do processo principal

```sh
grep -E "VmRSS|VmSize|VmPeak" /proc/1/status
```

## 3. Disco

### 3a. Com `df` (uso do filesystem do container)

```sh
df -h
```

### 3b. Sem `df` — via `/proc` e `stat` do statfs não dá em shell puro;
alternativa mínima quando `df` falta (raro, mas Alpine "scratch"-like pode
não ter coreutils completo):

```sh
cat /proc/mounts | awk '{print $2}' | sort -u
# tamanho grosseiro de um diretório específico sem `du`:
find /app -maxdepth 2 -type f -exec wc -c {} + 2>/dev/null | awk '{s+=$1} END{printf "%.1f MB\n", s/1024/1024}'
```

### 3c. Maiores consumidores dentro do container (com `du`)

```sh
du -sh /app/* 2>/dev/null | sort -rh | head -15
du -sh /var/lib/* 2>/dev/null | sort -rh | head -10   # útil no container do Postgres
```

### 3d. Volume de dados montado (Postgres, uploads, etc.)

```sh
df -h | grep -vE "overlay|tmpfs|shm$"
```
Isso separa o filesystem efêmero do container do volume persistente que o
Dokploy montou — é o volume que importa pra saber se vai encher.

## 4. Uptime e Load

### 4a. Com `uptime`

```sh
uptime
```

### 4b. Sem `uptime` — `/proc/loadavg` e `/proc/uptime` (sempre funcionam)

```sh
awk '{printf "load avg (1/5/15min): %s %s %s\n", $1, $2, $3}' /proc/loadavg
awk '{printf "uptime do kernel/host: %.1f horas\n", $1/3600}' /proc/uptime
```
**Atenção:** `/proc/loadavg` dentro de um container normalmente reflete o
load do **host** (a EC2 inteira), não só deste container — containers não
namespaceiam load average. Não confunda "load alto" com "esse serviço está
sobrecarregado": cruze com a CPU% do passo 1b/1c, que aí sim é por-cgroup.

### 4c. Uptime do próprio processo (desde quando o serviço está de pé,
útil pra saber se houve restart/OOM kill recente)

```sh
# GNU/procps (não confie nisso em busybox — ver nota da seção 1c)
ps -o etime,lstart -p 1 2>/dev/null
# via /proc — funciona em qualquer sh/busybox: mtime de /proc/1 == start do PID 1
stat -c '%y' /proc/1 2>/dev/null || ls -la /proc/1 | head -1
```

## 5. Processos e conexões (bônus — completa o quadro)

```sh
# processos do container — em busybox "ps aux"/"ps -ef" podem falhar ou
# ignorar as flags; "ps" puro (sem flags) é o formato garantido do busybox
ps aux 2>/dev/null || ps -ef 2>/dev/null || ps 2>/dev/null || ls /proc | grep -E '^[0-9]+$'

# conexões de rede abertas (nem sempre disponível, precisa net-tools/iproute2)
ss -tunap 2>/dev/null || netstat -tunap 2>/dev/null || echo "ss/netstat indisponíveis nesta imagem"

# file descriptors abertos pelo processo principal (detecta fd leak)
ls /proc/1/fd 2>/dev/null | wc -l
```

## 6. Um comando único (copiar-colar) — "foto" rápida

Cole isso inteiro no terminal do container para um resumo de uma vez só
(funciona mesmo sem `top`/`free`/`df`, usando só `/proc`):

```sh
echo "== HOST/CONTAINER SNAPSHOT $(date -u +%FT%TZ) =="
echo "--- CPU ---"
nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
cat /sys/fs/cgroup/cpu.max 2>/dev/null || cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null
echo "--- MEMORY (cgroup) ---"
{ echo -n "used(MB): "; cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null; } | awk '{printf "%s%.1f\n", $1, $NF/1024/1024}'
{ echo -n "limit: "; cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null; }
echo "--- MEMORY (proc) ---"
awk '/MemTotal|MemAvailable/ {printf "%-15s %8.1f MB\n", $1, $2/1024}' /proc/meminfo
echo "--- DISK ---"
df -h 2>/dev/null | grep -vE "overlay|tmpfs|shm$" || cat /proc/mounts | awk '{print $2}' | sort -u
echo "--- UPTIME / LOAD (host-wide, ver nota na secao 4b) ---"
awk '{printf "load 1/5/15: %s %s %s\n", $1, $2, $3}' /proc/loadavg
awk '{printf "kernel uptime: %.1f h\n", $1/3600}' /proc/uptime
echo "--- PROCESS (pid 1) ---"
ps -o pid,%cpu,%mem,etime,cmd -p 1 2>/dev/null || ps 2>/dev/null | grep -E "^\s*1\s" || cat /proc/1/stat
echo "== END SNAPSHOT =="
```

## 7. Fora do container: pelo host (Dokploy/EC2), se tiver SSH

Dá o quadro completo da VM (útil pra comparar com o que os containers
individuais reportam, e pra ver *todos* os containers de uma vez):

```sh
# uma linha por container: CPU%, MEM uso/limite, MEM%, NET I/O, BLOCK I/O
docker stats --no-stream

# só o que interessa, formatado
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

# disco da VM inteira (contexto do incidente OOM do t3.medium sem swap)
df -h
free -h
uptime
```

## 8. Notas específicas do ambiente MYIO

- A EC2 de produção do Dokploy é um **t3.medium (~4GB RAM)**. Houve um
  incidente histórico de OOM em build on-host sem swap, que motivou o
  cutover para build no GitHub Actions → GHCR → Dokploy só faz `pull` (ver
  `docs/ops/CI-BUILD-DEPLOY-GHCR-DOKPLOY.md`). **Atualização
  (2026-09-17):** o snapshot real do container `gcdr-backend-api` mostrou
  `Swap: 4.0G total, 224.1M used, 3.8G free` (via `free -h`) — ou seja, a VM
  **tem swap hoje**, diferente do estado "sem swap" do incidente original.
  Não assuma mais "sem swap" sem checar `free -h`/seção 2 primeiro; trate
  isso como algo que pode ter mudado desde a nota histórica.
- Ao tirar a foto de memória de um container, sempre compare o
  `memory.current` (passo 2c) com o total disponível na VM
  (`docker stats`/`free -h` no host) — é fácil um container individual
  parecer saudável enquanto a VM como um todo está no limite.
- O worker `orchestrator-devices` roda como processo **sibling** da API no
  mesmo container/imagem — ao investigar CPU/memória desse serviço,
  confira `ps aux` (passo 5) pra separar o consumo do processo da API do
  processo do worker, já que ambos aparecem no mesmo `docker stats`.
- Containers Postgres: rode os passos 3c/3d apontando pro `PGDATA` (em
  geral `/var/lib/postgresql/data`) para separar o volume persistente do
  filesystem efêmero da imagem.

## 9. Formato dos snapshots versionados (`snapshots/*.json`)

Cada captura vira um arquivo `snapshots/<YYYY-MM-DD>-<service>.json`
(pode haver mais de um por dia/serviço — nesse caso sufixe com `-HHmm`).
Isso permite comparar ao longo do tempo (`git log -p` no arquivo) sem
depender de olhar screenshots ou colar texto solto no chat.

Campos principais: `capturedAt`, `container.service`, `cpu` (cpuCount,
loadAverage, top/proc-stat samples), `memory` (total/free/available/swap em
MB, via `free -h` e `/proc/meminfo`), `disk` (por mount, size/used/avail/
use%), `uptime` (host uptime, load average), `process.pid1` (nome, cmd,
%VSZ, threads, RSS), `rawOutputs` (texto bruto de cada comando, para
auditoria), e `notes` (qualquer anomalia observada na captura, ex.: comando
reexecutado incorretamente, discrepância de horário, etc.).

Ver [`snapshots/2026-09-17-gcdr-backend-api.json`](./snapshots/2026-09-17-gcdr-backend-api.json)
como exemplo real.
