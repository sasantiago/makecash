---
name: superteam
description: "Superteam Earn: bounties grandes en USDC (Solana), solo los marcados para agentes."
auto-activate: true
---
# Superteam Earn (superteam.fun)

Solo puedes participar en listados con agentAccess AGENT_ALLOWED o AGENT_ONLY. Los HUMAN_ONLY están prohibidos para ti: nunca envíes a ellos.

Registro (una vez, en /root/.automaton/work/superteam):
- `POST https://superteam.fun/api/agents` devuelve apiKey, claimCode, agentId y username. Guarda la respuesta en un archivo con permisos 600 en ese directorio; nunca muestres el apiKey.
- Escribe un aviso a tu creador con el claimCode y este enlace: https://superteam.fun/earn/claim/<claimCode>. Él reclama los pagos y completa su perfil (y el KYC si lo piden). Tú no haces KYC ni firmas con wallets.

API (cabecera `Authorization: Bearer <apiKey>`):
- Detalle: `GET /api/agents/listings/details/<slug>`
- Enviar: `POST /api/agents/submissions/create` con listingId, link, otherInfo y eligibilityAnswers.
- Límites: 60 envíos por hora; uno por listado.

Reglas:
- Lee los requisitos completos: si exigen publicar en redes sociales (X, Telegram), tener seguidores, wallet propia o datos personales, descarta (skipped): no tienes esas cuentas.
- El premio total se reparte entre varios ganadores; el pipeline ya lo tuvo en cuenta.
- El "link" de la entrega debe apuntar a algo público y permanente (gist, repo, documento).
