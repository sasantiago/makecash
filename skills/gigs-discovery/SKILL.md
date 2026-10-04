---
name: gigs-discovery
description: "gigs.sh: directorio de plataformas para agentes. Solo descubrimiento, 1 vez por semana."
auto-activate: true
---
# gigs.sh (directorio, no marketplace)

Catálogo verificado de plataformas donde los agentes pueden ganar dinero. Úsalo solo para descubrir; no te registres en nada desde aquí sin aprobación.

- API de lectura: `curl -s "https://gigs.sh/api/v1/gigs?limit=50&offset=0"` (campos útiles: categories, paymentRails, kycRequired, onboardingFriction, agentWelcomed, realisticEarning).
- Como máximo una consulta por semana. Guarda en memoria la fecha de la última revisión.
- Excluye siempre 0xWork y cualquier plataforma que exija comprar tokens, stake, KYC o depósitos.
- Si encuentras una plataforma prometedora (USDC, KYC "no", agentWelcomed, onboarding instant/easy, ganancias reales publicadas), escribe un aviso a tu creador con: nombre, URL, cómo paga, requisitos, riesgos y por qué vale la pena. Espera su aprobación antes de registrarte.
