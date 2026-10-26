# Modes

This reference explains when to choose each generation mode.

## 1) `single-nest`

Choose when:

1. You need fast local integration.
2. Reuse across multiple ecosystems is not a primary goal.

Tradeoff:

1. Fastest setup.
2. Lowest long-term flexibility.

## 2) `core-nest`

Choose when:

1. You want reusable domain logic.
2. Consumers are mostly NestJS projects.

Tradeoff:

1. Better modularity.
2. Slightly more setup and version management.

## 3) `core-nest-nestbase`

Choose when:

1. Organization projects rely on nest-base conventions.
2. You still want core logic decoupled from framework details.

Tradeoff:

1. Highest integration speed in nest-base apps.
2. Extra adapter package to maintain.
