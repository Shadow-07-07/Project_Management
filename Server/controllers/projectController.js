import prisma from "../configs/prisma.js"
import { clerkClient } from "@clerk/express";

// create project
export const createProject = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { workspaceId, description, name, status, start_date, end_date, team_members, team_lead, progress, priority } = req.body;

    // check if user had admin role or is owner for workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { include: { user: true } } }
    });
    if (!workspace) {
      return res
        .status(404)
        .json({ message: "Workspace not found!!" })
    }

    const isAdmin = workspace.ownerId === userId || workspace.members.some((member) => member.userId === userId && member.role === "ADMIN");
    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: "You do not have permission to create projects in this workspace" })
    }

    // get team lead using email or id
    let leadId = null;
    if (team_lead) {
      const teamLeadByEmail = await prisma.user.findUnique({
        where: { email: team_lead },
        select: { id: true }
      });
      if (teamLeadByEmail) {
        leadId = teamLeadByEmail.id;
      } else {
        const teamLeadById = await prisma.user.findUnique({
          where: { id: team_lead },
          select: { id: true }
        });
        if (teamLeadById) {
          leadId = teamLeadById.id;
        }
      }
    }

    // Fallback to creator's userId if lead not found or not specified
    if (!leadId) {
      leadId = userId;
    }

    // Ensure leadId exists in prisma.user (crucial for foreign key constraint)
    const existingLead = await prisma.user.findUnique({ where: { id: leadId } });
    if (!existingLead) {
      try {
        const clerkUser = await clerkClient.users.getUser(leadId);
        const email = clerkUser.emailAddresses?.[0]?.emailAddress || `${leadId}@example.com`;
        const userName = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim() || clerkUser.username || "User";
        await prisma.user.upsert({
          where: { id: leadId },
          update: { email, name: userName, image: clerkUser.imageUrl || "" },
          create: { id: leadId, email, name: userName, image: clerkUser.imageUrl || "" }
        });
      } catch (err) {
        console.error("Error creating user for project lead:", err);
      }
    }

    const parsedProgress = typeof progress === "number" ? progress : parseInt(progress) || 0;

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name,
        description,
        status: status || "PLANNING",
        progress: parsedProgress,
        priority: priority || "MEDIUM",
        team_lead: leadId,
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
      }
    });

    // add members to project if they are in the workspace
    const membersToAdd = new Set();
    if (leadId) membersToAdd.add(leadId);

    if (team_members && Array.isArray(team_members) && team_members.length > 0) {
      workspace.members.forEach(member => {
        if (member.user && (team_members.includes(member.user.email) || team_members.includes(member.userId))) {
          membersToAdd.add(member.userId);
        }
      });
    }

    if (membersToAdd.size > 0) {
      await prisma.projectMember.createMany({
        data: Array.from(membersToAdd).map(memberId => ({
          projectId: project.id,
          userId: memberId
        })),
        skipDuplicates: true
      });
    }

    const projectWithMembers = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        members: { include: { user: true } },
        tasks: {
          include: { assignee: true, comments: { include: { user: true } } }
        },
        owner: true
      }
    });

    res.json({ project: projectWithMembers, message: "Project created successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message });
  }
}


// update project
export const updateProject = async (req, res) => {
  try {
    const { userId } = await req.auth()
    const { id, workspaceId, description, name, status, start_date, end_date, progress, priority } = req.body;

    let targetWorkspaceId = workspaceId;
    if (!targetWorkspaceId) {
      const existing = await prisma.project.findUnique({ where: { id } });
      targetWorkspaceId = existing?.workspaceId;
    }

    // check if user had admin role in the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: targetWorkspaceId },
      include: { members: { include: { user: true } } }
    });
    if (!workspace) {
      return res
        .status(404)
        .json({ message: "Workspace not found!!" })
    }

    const isAdmin = workspace.ownerId === userId || workspace.members.some((member) => member.userId === userId && member.role === "ADMIN");
    if (!isAdmin) {
      const project = await prisma.project.findUnique({
        where: { id }
      })
      if (!project) {
        return res
          .status(404)
          .json({ message: "Project not found" })
      }
      else if (project.team_lead !== userId) {
        return res
          .status(403)
          .json({ message: "You don't have permission to update projects in this workspace" })
      }
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        workspaceId: targetWorkspaceId,
        description,
        name,
        status,
        priority,
        progress,
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
      },
      include: {
        members: { include: { user: true } },
        tasks: { include: { assignee: true, comments: { include: { user: true } } } },
        owner: true
      }
    })

    res.json({ project, message: "Project updated successfully" })

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message })
  }
}

// add member to project
export const addMember = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { projectId } = req.params;
    const { email } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res
        .status(400)
        .json({ message: "Email is required" })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { include: { user: true } } }
    })
    if (!project) {
      return res
        .status(404)
        .json({ message: "Project not found!!" })
    }

    if (project.team_lead !== userId) {
      return res
        .status(403)
        .json({ message: "Only project lead can add members" })
    }

    // check if user is already a member
    const normalizedEmail = email.trim()
    const existingMember = project.members.find((member) => member.user.email === normalizedEmail)
    if (existingMember) {
      return res
        .status(400)
        .json({ message: "User is already a member" })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found" })
    }

    const workspaceMember = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: project.workspaceId
        }
      }
    })
    if (!workspaceMember) {
      return res
        .status(400)
        .json({ message: "User is not a member of this project's workspace" })
    }

    const member = await prisma.projectMember.create({
      data: {
        userId: user.id,
        projectId
      }
    })

    res.json({ member, message: "Member added successfully" })

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.code || error.message })
  }
}