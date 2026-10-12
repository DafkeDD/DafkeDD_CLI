import { nestjs } from './nestjs.js'

// Add more backends here later (express, fastify, ...)
export const backends = { [nestjs.id]: nestjs }
