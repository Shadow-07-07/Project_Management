import { Inngest } from "inngest";
import prisma from "../configs/prisma.js";
import sendEmail from "../configs/nodemailer.js";

// Create Inngest client
export const inngest = new Inngest({
  id: "project-management",
  isDev: process.env.NODE_ENV !== "production",
});

// Sync user creation from Clerk
const syncUserCreation = inngest.createFunction(
  {
    id: "sync-user-from-clerk",
    triggers: [{ event: "clerk/user.created" }],
  },
  async ({ event }) => {
    const { data } = event;
    console.log(`[Inngest] clerk/user.created received for: ${data?.id}`);

    const email = data?.email_addresses?.[0]?.email_address;
    const name = `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || data?.username || "User";
    const image = data?.image_url || data?.profile_image_url || "";

    if (!data?.id || !email) {
      console.error("[Inngest] Missing required user data:", { id: data?.id, email });
      return;
    }

    // Clean up any stale user record with the same email under an old Clerk ID
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail && existingByEmail.id !== data.id) {
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { email: `stale_${Date.now()}_${email}` },
      }).catch(() => { });
      await prisma.user.delete({ where: { id: existingByEmail.id } }).catch(() => { });
    }

    const user = await prisma.user.upsert({
      where: { id: data.id },
      update: {
        email,
        name,
        image,
      },
      create: {
        id: data.id,
        email,
        name,
        image,
      },
    });

    console.log(`[Inngest] User synced successfully: ${user.id}`);
    return { success: true, user };
  }
);

// Sync user deletion from Clerk
const syncUserDeletion = inngest.createFunction(
  {
    id: "delete-user-with-clerk",
    triggers: [{ event: "clerk/user.deleted" }],
  },
  async ({ event }) => {
    const { data } = event;

    if (!data.id) return;

    await prisma.user.deleteMany({
      where: {
        id: data.id,
      },
    });
  }
);

// Sync user updates from Clerk
const syncUserUpdation = inngest.createFunction(
  {
    id: "update-user-from-clerk",
    triggers: [{ event: "clerk/user.updated" }],
  },
  async ({ event }) => {
    const { data } = event;

    await prisma.user.updateMany({
      where: {
        id: data.id,
      },
      data: {
        email: data?.email_addresses?.[0]?.email_address,
        name: `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim(),
        image: data?.image_url,
      },
    });
  }
);

// Inngest function to save workspace data to database
const syncWorkspaceCreation = inngest.createFunction(
  {
    id: "sync-workspace-from-clerk",
    triggers: [{ event: "clerk/organization.created" }]
  },
  async ({ event }) => {
    const { data } = event;
    console.log(`[Inngest] clerk/organization.created received for: ${data.id}`);

    // Ensure creator exists in NeonDB first to satisfy foreign key constraint
    if (data.created_by) {
      const existingUser = await prisma.user.findUnique({ where: { id: data.created_by } });
      if (!existingUser) {
        await prisma.user.create({
          data: {
            id: data.created_by,
            name: "User",
            email: `${data.created_by}@placeholder.com`,
          }
        }).catch(() => { });
      }
    }

    await prisma.workspace.upsert({
      where: { id: data.id },
      update: {
        name: data.name,
        slug: data.slug,
        image_url: data.image_url || "",
      },
      create: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        ownerId: data.created_by,
        image_url: data.image_url || "",
      }
    });

    // Add creator as Admin member 
    if (data.created_by) {
      await prisma.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId: data.created_by,
            workspaceId: data.id,
          }
        },
        update: {
          role: "ADMIN",
        },
        create: {
          userId: data.created_by,
          workspaceId: data.id,
          role: "ADMIN",
        }
      });
    }
    console.log(`[Inngest] Workspace created and synced to NeonDB: ${data.id}`);
  }
);

// Inngest function to update workspace data in database
const syncWorkspaceUpdation = inngest.createFunction(
  {
    id: "update-workspace-from-clerk",
    triggers: [{ event: "clerk/organization.updated" }],
  },
  async ({ event }) => {
    const { data } = event;
    if (!data.id) return;

    await prisma.workspace.updateMany({
      where: {
        id: data.id,
      },
      data: {
        name: data.name,
        slug: data.slug,
        image_url: data.image_url || "",
      }
    });
    console.log(`[Inngest] Workspace updated in NeonDB: ${data.id}`);
  }
);

// Inngest function to delete workspace from database
const syncWorkspaceDeletion = inngest.createFunction(
  {
    id: "delete-workspace-with-clerk",
    triggers: [{ event: "clerk/organization.deleted" }],
  },
  async ({ event }) => {
    const { data } = event;
    if (!data.id) return;

    await prisma.workspace.deleteMany({
      where: {
        id: data.id,
      },
    });
    console.log(`[Inngest] Workspace deleted from NeonDB: ${data.id}`);
  }
);

// Inngest function to save workspace member data to database
const syncWorkspaceMemberCreation = inngest.createFunction(
  {
    id: "sync-workspace-member-from-clerk",
    triggers: [
      { event: "clerk/organizationMembership.created" },
      { event: "clerk/organizationInvitation.accepted" }
    ],
  },
  async ({ event }) => {
    const { data } = event;
    const userId = data.public_user_data?.user_id || data.user_id;
    const workspaceId = data.organization?.id || data.organization_id;
    const rawRole = String(data.role || data.role_name || "").toUpperCase();
    const role = rawRole.includes("ADMIN") ? "ADMIN" : "MEMBER";

    if (!userId || !workspaceId) return;

    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        }
      },
      update: {
        role,
      },
      create: {
        userId,
        workspaceId,
        role,
      },
    });
    console.log(`[Inngest] Workspace member synced: user ${userId} to workspace ${workspaceId} as ${role}`);
  }
);

// inngest function to send email on task creation
const sendTaskAssignmentEmail = inngest.createFunction(
  {
    id: 'send-task-assignment-mail',
    triggers: [{ event: "app/task.assigned" }],
  },
  async ({ event, step }) => {
    const { taskId, origin } = event.data;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true, project: true }
    })

    if (!task) {
      throw new Error(`Cannot send assignment email: task ${taskId} was not found`);
    }
    if (!task.assignee || !task.project) {
      throw new Error(`Cannot send assignment email: task ${taskId} is missing its assignee or project`);
    }

    if(new Date(task.due_date).toLocaleDateString() !== new Date().toDateString()){
      await step.sleepUntil('wait-for-the-due-date', new Date(task.due_date))

      await step.run('check-if-task-is-completed', async () => {
        const task = await prisma.task.findUnique({
          where: {id: taskId},
          include: {assignee: true, project: true}
        })

        if(!task) return ;

        if(task.status !== "DONE"){
          await step.run('send-task-reminder-email', async() => {
            await sendEmail({
              to: task.assignee.email,
              subject: `Reminder for ${task.project.name}`,
              body: `
                  <div style="max-width: 600px;">
                    <h2>Hi ${task.assignee.name}, 👋</h2>

                    <p style="font-size: 16px;">You have a task due in ${task.project.name}:</p>

                    <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">
                        ${task.title}
                    </p>

                    <div style="border: 1px solid #ddd; padding: 12px 16px; border-radius: 6px; margin-bottom: 30px;">
                        <p style="margin: 6px 0;">
                            <strong>Description:</strong> ${task.description}
                        </p>

                        <p style="margin: 6px 0;">
                            <strong>Due Date:</strong> ${new Date(task.due_date).toLocaleDateString()}
                        </p>
                    </div>

                    <a href="${origin}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none;">
                        View Task
                    </a>

                    <p style="margin-top: 20px; font-size: 14px; color: #6c757d;">
                        Please make sure to review and complete it before the due date.
                    </p>
                  </div>`
            })
          })
        }
      })
    }
  }
)

// Export Inngest functions
export const functions = [
  syncUserCreation,
  syncUserDeletion,
  syncUserUpdation,
  syncWorkspaceCreation,
  syncWorkspaceUpdation,
  syncWorkspaceDeletion,
  syncWorkspaceMemberCreation,
  sendTaskAssignmentEmail
];