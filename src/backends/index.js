import { linked } from './linked.js'
import { nestjs } from './nestjs.js'

// Add more backends here later (express, fastify, ...)
// linked: no backend of its own, the frontend logs in at an existing DafkeDD OIDC server (link code)
export const backends = { [nestjs.id]: nestjs, [linked.id]: linked }
