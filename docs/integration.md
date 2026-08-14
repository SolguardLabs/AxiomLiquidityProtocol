# Integración

## Instalación

```bash
bun install --frozen-lockfile
```

El paquete usa ESM y requiere Node.js 24 o superior.

## Composición

```ts
import {
    AxiomControlPlane,
    AxiomProtocol,
    asset,
    bps,
} from "@solguardlabs/axiom-liquidity-protocol";

const protocol = new AxiomProtocol({
    vault: {
        asset: "USDC",
        name: "Axiom Managed Liquidity Vault",
        shareSymbol: "axUSDC",
        performanceFeeBps: bps(1_500),
        minInitialDeposit: asset(1_000),
        minIdleBps: bps(500),
        maxWithdrawalBps: bps(7_500),
    },
    risk: {
        maxStrategyAllocationBps: bps(8_500),
        maxPoolAllocationBps: bps(7_500),
        maxRangeWidthBps: bps(4_000),
        maxReportLossBps: bps(4_500),
        maxStrategistFeeBps: bps(2_000),
        minRangeLiquidity: asset(500),
        maxOpenPositionsPerStrategy: 12,
        maxPoolExitPenaltyBps: bps(500),
    },
});

const controls = new AxiomControlPlane(protocol, "governor-service");
```

## Cantidades

No pases floats a los servicios:

```ts
asset("1250.75"); // 1_250_750_000n
bps(1500); // 15 %
```

Los resultados devuelven `bigint`. Un API JSON debe serializarlos como strings decimales y
recuperarlos con `BigInt(value)`.

## Registro mínimo

1. Registra cuentas y saldo externo.
2. Registra pools.
3. Crea estrategias y rangos.
4. Deposita capital.
5. Concede roles operativos.
6. Ejecuta asignaciones mediante el control plane.

## Reporting

```ts
controls.grantRole("governor-service", "reporter", "reporter-service");

const result = controls.report("reporter-service", {
    strategyId: "stable-range-alpha",
    timestamp: Date.now(),
    note: "hourly valuation cycle",
});

console.log(result.adjustedValue, result.feeShares, result.totalAssetsAfter);
```

## Riesgo

```ts
const snapshot = protocol.economicRisk.evaluate({
    marketLossBps: bps(800),
    liquidityHaircutBps: bps(400),
    exitPenaltyShockBps: bps(150),
    lossAlertBps: bps(1_500),
    maximumReportAgeMs: 60 * 60 * 1_000,
});

if (!snapshot.healthy) {
    console.error(snapshot.flags);
}
```

## Persistencia e idempotencia

Las clases operan en memoria. Para exponerlas como servicio:

- serializa por identificador de vault;
- persiste petición, resultado, snapshot y eventos en una transacción;
- asigna una idempotency key a cada mutación;
- reconstruye roles y pausas antes de aceptar tráfico;
- no compartas una instancia mutable entre procesos sin coordinación.

## Errores

Las validaciones de dominio lanzan `AxiomError` con código y metadata. Traduce los códigos a
respuestas de aplicación sin ocultar el checkpoint interno asociado.

## Observabilidad

`EventLog.checkpoint()` devuelve el siguiente event id. Usa `since(checkpoint)` para capturar los
eventos de una operación y enviarlos a almacenamiento append-only.
