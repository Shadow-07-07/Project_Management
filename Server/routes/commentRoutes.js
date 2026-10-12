import express from 'express'
import { addComment, getTaskComments } from '../controllers/commentController.js'

const commentRouter = express.Router()

commentRouter.get('/:taskId', getTaskComments)
commentRouter.post('/', addComment)

export default commentRouter