# Seguridad

Este documento describe el modelo de seguridad esperado de AxiomLiquidityProtocol.

## Modelo de confianza

- Los depositantes confian en que las shares representan una fraccion proporcional del NAV del
  vault.
- Los estrategas solo pueden operar estrategias registradas y dentro de los limites del
  `RiskController`.
- Los pools externos son adaptadores simulados, pero exponen estados economicamente relevantes:
  fees, valor de salida, rango activo, perdidas y deslizamiento.
- Las politicas de fee y riesgo se tratan como componentes internos del protocolo.

## Invariantes esperadas

- `idleAssets + managedAssets` debe reconciliar con el NAV publicado.
- Cada deposito debe emitir shares usando el precio por share vigente antes de recibir el nuevo
  efectivo.
- Cada retiro debe quemar shares antes de entregar efectivo al usuario.
- Las asignaciones no deben superar los limites de estrategia, pool o liquidez idle.
- Los reportes no deben aceptar estados que excedan tolerancias operativas de perdida.
- Los eventos deben permitir reconstruir depositos, asignaciones, reportes y retiros.

## Validacion automatizada

Los tests publicos cubren:

- depositos iniciales y posteriores;
- creacion y asignacion de estrategias;
- fees de rendimiento bajo reportes positivos;
- reduccion de NAV ante perdidas;
- retiros contra liquidez idle y liquidez recordada desde estrategias;
- vistas agregadas y eventos de auditoria.

## Gestion de dependencias

El proyecto no usa dependencias de runtime. Las dependencias de desarrollo se limitan a
TypeScript, tipos de Node y Prettier.

## Alcance de revision

La revision debe centrarse en:

- conversiones entre activos y shares;
- orden de actualizacion entre pools, estrategias y vault;
- limites del `RiskController`;
- atribucion de fees;
- reconciliacion de NAV despues de perdidas y retiros;
- consistencia entre vistas de reporting y estado ejecutable.

## Reportes internos

Un reporte de seguridad debe incluir:

- descripcion del comportamiento observado;
- impacto economico;
- pasos de reproduccion;
- estado inicial minimo;
- recomendacion de mitigacion;
- tests de regresion propuestos.
