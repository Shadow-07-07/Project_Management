import prisma from "../configs/prisma.js";
import { inngest } from "../inngest/index.js";
import sendEmail from "../configs/nodemailer.js";


// create a task
export const createTask = async (req, res) => {
  try {
    const { userId } = await req.auth()
    const { projectId, title, description, type, status, priority, assigneeId, due_date } = req.body;
    const origin = req.get('origin');

    // check if user has access to project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: { include: { user: true } },
        workspace: { include: { members: { include: { user: true } } } },
        owner: true
      }
    })
    if (!project) {
      return res
        .status(404)
        .json({ message: "Project not found" })
    }

    const isTeamLead = project.team_lead === userId;
    const isWorkspaceAdmin = project.workspace?.members?.some((m) => m.userId === userId && m.role === "ADMIN");
    const isProjectMember = project.members.some((m) => m.userId === userId);

    if (!isTeamLead && !isWorkspaceAdmin && !isProjectMember) {
      return res
        .status(403)
        .json({ message: "You don't have permission to create tasks for this project" })
    }

    // Default assignee to userId if none provided or empty
    const finalAssigneeId = assigneeId && assigneeId.trim() !== "" ? assigneeId : userId;

    const isAssigneeInWorkspace =
      finalAssigneeId === project.team_lead ||
      project.members.some((member) => member.userId === finalAssigneeId) ||
      project.workspace?.members?.some((member) => member.userId === finalAssigneeId);

    if (!isAssigneeInWorkspace) {
      return res
        .status(403)
        .json({ message: "Assignee is not a member of the project or workspace" })
    }

    // Link assignee to project members if not already linked
    if (finalAssigneeId !== project.team_lead && !project.members.some((m) => m.userId === finalAssigneeId)) {
      await prisma.projectMember.create({
        data: { projectId, userId: finalAssigneeId }
      }).catch(() => {});
    }

    const task = await prisma.task.create({
      data: {
        projectId,
        title,
        description,
        priority: priority || "MEDIUM",
        assigneeId: finalAssigneeId,
        status: status || "TODO",
        type: type || "TASK",
        due_date: due_date ? new Date(due_date) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    })

    const taskWithAssignee = await prisma.task.findUnique({
      where: { id: task.id },
      include: { assignee: true, comments: { include: { user: true } } }
    })

    try {
      await sendEmail({
        to: taskWithAssignee.assignee.email,
        subject: `New Task Assignment in ${project.name}`,
        body: `
          <div style="max-width: 600px;">
            <h2>Hi ${taskWithAssignee.assignee.name},</h2>
            <p style="font-size: 16px;">You've been assigned a new task:</p>
            <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">
              ${task.title}
            </p>
            <div style="border: 1px solid #ddd; padding: 12px 16px; border-radius: 6px; margin-bottom: 30px;">
              <p style="margin: 6px 0;"><strong>Description:</strong> ${task.description || "No description provided"}</p>
              <p style="margin: 6px 0;"><strong>Due Date:</strong> ${new Date(task.due_date).toLocaleDateString()}</p>
            </div>
            <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none;">
              View Task
            </a>
          </div>`
      })
    } catch (error) {
      console.error("Task created, but assignment email could not be sent:", error);
    }

    try {
      await inngest.send({
        name: 'app/task.assigned',
        data: {
          taskId: task.id,
          origin
        }
      })
    } catch (error) {
      console.error("Task created, but assignment notification could not be queued:", error);
    }

    res.json({ task: taskWithAssignee, message: "Task created successfully" })

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message })
  }
}

// update a task
export const updateTask = async (req, res) => {
  try {

    // find task
    const task = await prisma.task.findUnique({
      where: { id: req.params.id }
    })
    if (!task) {
      return res
        .status(404)
        .json({ message: "Task not found" })
    }

    const { userId } = await req.auth()
 
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      include: { members: { include: { user: true } } }
    })
    if (!project) {
      return res
        .status(404)
        .json({ message: "Project not found" })
    }
    const isTeamLead = project.team_lead === userId;
    const isAssignee = task.assigneeId === userId;
    const isProjectMember = project.members.some((m) => m.userId === userId);

    if (!isTeamLead && !isAssignee && !isProjectMember) {
      return res
        .status(403)
        .json({ message: "You don't have permission to update tasks for this project" });
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        assignee: true,
        comments: { include: { user: true } }
      }
    })

    res.json({ task: updatedTask, message: "Task updated successfully" })

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message })
  }
}


// delete a task
export const deleteTask = async (req, res) => {
  try {
    const { userId } = await req.auth()
    const { taskIds } = req.body

    if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((taskId) => typeof taskId !== "string")) {
      return res
        .status(400)
        .json({ message: "A list of task IDs is required" })
    }

    const uniqueTaskIds = [...new Set(taskIds)]

    const tasks = await prisma.task.findMany({
      where: { id: { in: uniqueTaskIds } },
      include: { project: { select: { team_lead: true } } }
    })

    if (tasks.length !== uniqueTaskIds.length) {
      return res
        .status(404)
        .json({ message: "Task not found" })
    }

    if (tasks.some((task) => task.project.team_lead !== userId)) {
      return res
        .status(403)
        .json({ message: "You don't have admin privileges for this project" })
    }

    await prisma.task.deleteMany({
      where: { id: { in: uniqueTaskIds } }
    })

    res.json({ message: "Task deleted successfully" })

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message })
  }
}