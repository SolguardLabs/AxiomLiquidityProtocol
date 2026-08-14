# Documentación técnica

Esta carpeta describe el diseño verificable de AxiomLiquidityProtocol.

| Documento                                        | Contenido                                         |
| ------------------------------------------------ | ------------------------------------------------- |
| [architecture.md](./architecture.md)             | Componentes, dependencias y fronteras de estado.  |
| [economic-model.md](./economic-model.md)         | NAV, shares, valoración, fees y stress waterfall. |
| [strategy-lifecycle.md](./strategy-lifecycle.md) | Creación, asignación, reportes, recall y retiro.  |
| [risk-and-security.md](./risk-and-security.md)   | Roles, pausas, límites, flags e invariantes.      |
| [operations.md](./operations.md)                 | Runbooks, alertas y reconciliación.               |
| [integration.md](./integration.md)               | API TypeScript y patrones de integración.         |

Los ejemplos utilizan las funciones exportadas por `src/index.ts` y cantidades `bigint` con seis
decimales.
