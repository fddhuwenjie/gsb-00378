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
app.use((error: Error & { status?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
  // body-parser 错误（如 entity.too.large）带有 status，必须保留原始状态码
  const status = typeof error.status === 'number' ? error.status : 500
  const message =
    status === 413
      ? 'Request entity too large'
      : status === 400
        ? 'Invalid request body'
        : 'Server internal error'
  res.status(status).json({
    success: false,
    error: message,
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
