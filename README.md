# AxiomLiquidityProtocol

![banner](./assets/banner.png)

AxiomLiquidityProtocol modela un protocolo de liquidez gestionada para un activo estable. Los
depositantes reciben participaciones del vault y los estrategas asignan capital entre pools
externos simulados usando rangos de precio, presupuestos de riesgo y reportes periodicos de NAV.

El proyecto esta escrito en TypeScript moderno y usa el runner nativo de Node para validar los
flujos publicos del protocolo.

## Componentes principales

- `AxiomProtocol`: fachada de aplicacion para depositos, estrategias, asignaciones, reportes y
  retiros.
- `AxiomVault`: ledger de efectivo, activos gestionados y participaciones.
- `StrategyBook`: registro de estrategias, posiciones externas y checkpoints de valor.
- `ExternalPool`: simulador de pools con rangos, fees, deslizamiento e inventario.
- `PerformanceFeePolicy`: politica de cristalizacion de fees para estrategas.
- `RiskController`: limites operativos de asignacion, rangos, reportes y retiros.
- `ProtocolLens`: vistas agregadas para auditoria y pruebas.

## Requisitos

- Node.js 24 o superior.
- npm para instalar dependencias de desarrollo.

## Comandos

```bash
npm install
npm test
npm run typecheck
npm run ci
npm run demo
```

`npm test` ejecuta los tests TypeScript con `node --test --experimental-strip-types`.

## Flujo de protocolo

1. Los usuarios depositan el activo base y reciben shares del vault.
2. Un estratega registra una estrategia con limites de rango y fee.
3. El asignador mueve liquidez idle hacia pools externos simulados.
4. Los pools acumulan fees, mark-to-market y eventos de perdida.
5. El estratega reporta valor para actualizar el NAV y cristalizar fees.
6. Los retiros queman shares y reciben una fraccion proporcional del NAV vigente.

## Estructura

```text
src/
  adapters/
  domain/
  fees/
  math/
  reporting/
  risk/
  services/
  simulation/
  state/
  strategies/
  token/
  vault/
tests/
  node/
scripts/
```

## Estado

El laboratorio esta preparado para revision de seguridad de logica economica. Los tests publicos
cubren flujos esperados de depositos, asignacion de liquidez, acumulacion de fees, perdidas y
retiros.
