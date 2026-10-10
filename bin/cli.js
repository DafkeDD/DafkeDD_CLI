#!/usr/bin/env node
import { main } from '../src/index.js';

main().catch((err) => {
  if (err && err.name === 'ExitPromptError') {
    console.log('\nAfgebroken.');
    process.exit(130);
  }
  console.error(err?.message ?? err);
  process.exit(1);
});
