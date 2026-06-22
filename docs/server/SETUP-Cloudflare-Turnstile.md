# Cloudflare Turnstile — Setup Guide

Setup do captcha para o endpoint público de submissão de integrações wiki:
`POST /public/wiki/integrations/submit` (frontend: `/wiki/p/integrations/new`).

---

## O que é Turnstile

Substituto **gratuito e sem limites** da Cloudflare para o reCAPTCHA do Google.
Detecta bots olhando sinais do navegador (canvas fingerprint, user-agent
coerência, comportamento do mouse) **sem mostrar "selecione os ônibus"**. Na
maioria das vezes o usuário nem percebe — vê só um checkbox que se marca
sozinho. Privacy-first (não rastreia o usuário entre sites como o Google).

---

## Por que precisa criar widget no dashboard

O Turnstile usa o modelo padrão de captcha — **um par de chaves**:

| Chave | Onde fica | O que faz |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | Pública, no bundle do frontend | Diz pro widget "renderize um desafio pra **este site**" |
| `TURNSTILE_SECRET_KEY` | Secreta, só no backend | Assina o POST de verificação pra Cloudflare provar que **você é dono do site** |

Sem o widget cadastrado na CF, ela não sabe qual domínio está autorizado a usar
aquele par e não emite token. A CF também usa esse cadastro pra mostrar pra você
quantas requisições bateram, taxa de challenge, falhas — métricas por widget.

---

## Fluxo na prática

```
1. Browser carrega /wiki/p/integrations/new
2. TurnstileWidget injeta <script src=challenges.cloudflare.com/...>
3. Widget renderiza checkbox, CF avalia o navegador
4. CF emite TOKEN (válido ~5min, 1 uso) → callback no React → setCaptchaToken
5. Usuário clica "Enviar para revisão"
6. POST /public/wiki/integrations/submit { ..., captchaToken: "..." }
7. Backend chama https://challenges.cloudflare.com/turnstile/v0/siteverify
   com { secret: TURNSTILE_SECRET_KEY, response: token, remoteip }
8. CF responde { success: true }  → cria DRAFT
   ou             { success: false, "error-codes": [...] } → 400
```

O token é **one-shot e expira** — bot não consegue reaproveitar.

---

## Como criar (passo-a-passo)

1. Entrar em https://dash.cloudflare.com → menu lateral **Turnstile**
2. **Add site** (ou **Add widget**)
3. Preencher:
   - **Widget name**: `gcdr-public-integration-form` (qualquer nome — só pra
     você identificar)
   - **Hostnames**: `gcdr-web.a.myio-bas.com` (+ adicionar `localhost` se for
     testar em dev)
   - **Widget Mode**: **Managed** (recomendado — CF decide se mostra desafio
     ou só passa)
     - Alternativas:
       - *Non-Interactive* — nunca mostra UI
       - *Invisible* — sem widget visível, roda em background no submit
   - **Pre-clearance** (opcional): off
4. Clicar **Create**
5. A página seguinte mostra **Site Key** (`0x4AAA...` — pública) e **Secret
   Key** (`0x4AAA...` — secreta). Copiar as duas.
6. Setar:
   - Backend `.env`: `TURNSTILE_SECRET_KEY=0x4AAA...`
   - Frontend build (Dokploy, Vercel, ou onde você builda):
     `VITE_TURNSTILE_SITE_KEY=0x4AAA...`
7. Restart do backend, rebuild do frontend.

---

## Limites do free tier

- **1 milhão de challenges/mês grátis**, sem cartão de crédito (vs. reCAPTCHA
  Enterprise que é pago após 10k/mês).
- Suficiente pra qualquer caso prático de um formulário interno.

---

## Chaves de teste (pra dev)

A Cloudflare publica chaves "always pass" / "always fail" pra você testar sem
criar widget de verdade. Úteis se quiser sair do modo "bypass quando sem
secret":

| Cenário | Site key | Secret key |
|---|---|---|
| Sempre passa (visível) | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Sempre passa (invisível) | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Sempre falha | `3x00000000000000000000FF` | `3x0000000000000000000000000000000AA` |
| Forçar challenge interativo | `1x00000000000000000000AB` | — |

Lista completa: https://developers.cloudflare.com/turnstile/troubleshooting/testing/

---

## Modo dev sem chaves

Se as duas envs ficarem vazias:

- **Frontend** (`TurnstileWidget.tsx`): renderiza aviso âmbar
  "VITE_TURNSTILE_SITE_KEY não configurado — captcha desativado (dev)" e emite
  um token sintético `'dev-no-captcha'` imediatamente, deixando o submit
  prosseguir.
- **Backend** (`captchaVerifier.ts`): loga `WARN` e retorna
  `{ success: true, skipped: true }` sem chamar a CF.

Isso permite que o fluxo end-to-end seja testado localmente sem configurar
nada. **Não use em produção** — sem a verificação real, bots podem submeter
livremente (mitigação parcial sobra com rate-limit e honeypot).

---

## E se a MYIO não usar Cloudflare?

Não tem problema — você **não precisa** ter o domínio no Cloudflare pra usar o
Turnstile. É só criar conta gratuita na CF, cadastrar o hostname e usar as
chaves. O Turnstile funciona em qualquer hosting (Vercel, Dokploy, AWS, etc.).

Se preferir não depender da CF: dá pra trocar pra **hCaptcha** (mesma API, free
tier 1M/mês) só alterando o util `captchaVerifier.ts` (URL diferente, payload
similar). A escolha atual foi Turnstile.

---

## Arquivos relevantes

### Backend
- `src/shared/utils/captchaVerifier.ts` — POST pra `siteverify`, fallback dev
- `src/controllers/wiki-public.controller.ts` — endpoint chama
  `verifyTurnstileToken(token, clientIp)` antes de criar a página
- `.env.example` — `TURNSTILE_SECRET_KEY`

### Frontend
- `src/components/wiki/TurnstileWidget.tsx` — carrega script CF, renderiza
  widget, emite token via `onVerify`
- `src/pages/wiki/public/PublicWikiIntegrationForm.tsx` — usa o widget,
  bloqueia submit até `captchaToken` ser setado
- `.env.example` — `VITE_TURNSTILE_SITE_KEY`
- `src/vite-env.d.ts` — tipagem da env

---

## Defesas em camada

O endpoint `POST /public/wiki/integrations/submit` combina três defesas:

1. **Rate-limit** — 3 submissões/hora/IP (in-memory, bucket
   `wiki-public-integration-submit` em `middleware/rateLimit.ts`)
2. **Captcha** — Turnstile (este doc)
3. **Honeypot** — campo `website` invisível via CSS (`left: -9999px`); se um
   bot preencher, o backend retorna 202 sucesso falso pra não dar pista que
   foi detectado.

Se Turnstile cair (CF fora do ar), rate-limit + honeypot continuam ativos.
