/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import mergeRoutes from './routes/merge.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * API Routes
 */
app.use('/api', mergeRoutes)

/**
 * error handler middleware
 */
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  if (error && (error.type === 'entity.too.large' || error.status === 413)) {
    res.status(413).json({
      success: false,
      error: 'Request payload too large',
    })
    return
  }
  if (error && (error.type === 'entity.parse.failed' || error.status === 400)) {
    res.status(400).json({
      success: false,
      error: 'Invalid request body',
    })
    return
  }
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
