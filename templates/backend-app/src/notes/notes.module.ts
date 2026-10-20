import { Module } from '@nestjs/common'
import { NotesController } from './notes.controller.js'
import { NOTES_STORE } from './notes.store.js'
import { PgNotesStore } from './pg-notes.store.js'

@Module({
    controllers: [NotesController],
    providers: [{ provide: NOTES_STORE, useClass: PgNotesStore }]
})
export class NotesModule {}
