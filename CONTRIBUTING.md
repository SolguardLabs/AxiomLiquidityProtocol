# Contribución

## Flujo de trabajo

1. Crea una rama desde `main`.
2. Mantén cada cambio limitado a una responsabilidad económica u operativa.
3. Añade tests que expresen invariantes observables.
4. Ejecuta `bun install --frozen-lockfile` y `bun run ci`.
5. Abre un pull request con impacto, compatibilidad y evidencia de validación.

## Convenciones

- El código, los comentarios y los nombres técnicos se escriben en inglés.
- La documentación de producto se mantiene en español.
- Los importes monetarios usan enteros escalados; no se admiten cálculos con `number`.
- Los basis points deben validarse antes de entrar en modelos económicos.
- Los servicios mutables deben emitir eventos suficientes para reconstruir transiciones.
- Los cambios de roles, límites y pausas requieren tests negativos.

## Gate mínimo

```bash
bun install --frozen-lockfile
bun run ci
```

No se fusionan cambios con errores de tipos, formato o tests.
