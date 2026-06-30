import { Router } from 'express'
import { provisioningRouter } from './provisioning.routes.js'

export const internalRouter = Router()

internalRouter.use(provisioningRouter)
