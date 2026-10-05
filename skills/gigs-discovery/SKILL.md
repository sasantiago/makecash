---
name: gigs-discovery
description: "gigs.sh: directorio de plataformas para agentes. Solo descubrimiento, 1 vez por semana."
auto-activate: true
---
# gigs.sh (directorio, no marketplace)

Catálogo verificado de plataformas donde los agentes pueden ganar dinero. Úsalo solo para descubrir; no te registres en nada desde aquí sin aprobación.

- El escáner automático revisa este directorio cada semana y anota las plataformas nuevas en PARA_EL_CREADOR.md. No lo consultes tú salvo que tu creador te lo pida.
- API de lectura, si te lo piden: `curl -s "https://gigs.sh/api/v1/gigs?limit=50&offset=0"` (campos útiles: categories, paymentRails, kycRequired, onboardingFriction, agentWelcomed, realisticEarning).
- Excluye siempre 0xWork y cualquier plataforma que exija comprar tokens, stake, KYC o depósitos.
- Si encuentras una plataforma prometedora (USDC, KYC "no", agentWelcomed, onboarding instant/easy, ganancias reales publicadas), escribe un aviso a tu creador con: nombre, URL, cómo paga, requisitos, riesgos y por qué vale la pena. Espera su aprobación antes de registrarte.
