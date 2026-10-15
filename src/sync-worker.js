// Runs one subtitle sync off the main thread: the correlation maths would otherwise stall streaming for a moment per window.
import { parentPort, workerData } from 'node:worker_threads'
import { syncSubtitle, syncProbe } from './sync.js'

parentPort.postMessage(await (workerData.at != null ? syncProbe : syncSubtitle)(workerData).catch(() => null))
