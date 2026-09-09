import { defineConfig } from 'vite'
import vjTracksPlugin from './vite-plugin-vj-tracks.js'

export default defineConfig({
    base: "./",
    plugins: [vjTracksPlugin()]
})