// Shim vazio para módulos nativos do Node (fs, path, crypto) que o
// @techstark/opencv-js referencia via require() só dentro de um branch que
// nunca roda no navegador (ENVIRONMENT_IS_NODE é sempre falso lá) — mas o
// Turbopack ainda precisa conseguir *resolver* o require() em tempo de
// build, senão o build inteiro falha com "Module not found". Ver
// next.config.ts (turbopack.resolveAlias).
module.exports = {};
