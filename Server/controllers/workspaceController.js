import prisma from "../configs/prisma.js";
import { clerkClient } from "@clerk/express";

// Get all workspaces for user
export const getUserWorkspaces = async (req, res) => {
    try {
        const { userId } = await req.auth();

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        let workspaces = await prisma.workspace.findMany({
            where: {
                members: { some: { userId: userId } }
            },
            include: {
                members: { include: { user: true } },
                projects: {
                    include: {
                        tasks: { include: { 
                            assignee: true, 
                            comments: { include: { user: true } },
                        }},
                        members: { include: { user: true } }
                    }
                },
                owner: true,
            }
        });

        // Auto-sync with Clerk: Reconcile any newly created organizations or memberships
        try {
            const orgMemberships = await clerkClient.users.getOrganizationMembershipList({ userId });
            const clerkOrgIds = orgMemberships?.data?.map(m => m.organization.id) || [];
            const dbWorkspaceIds = new Set(workspaces.map(w => w.id));
            const hasMissingWorkspaces = clerkOrgIds.some(id => !dbWorkspaceIds.has(id));

            if ((hasMissingWorkspaces || workspaces.length === 0) && orgMemberships?.data && orgMemberships.data.length > 0) {
                // Ensure the user exists in NeonDB first
                const existingUser = await prisma.user.findUnique({ where: { id: userId } });
                if (!existingUser) {
                    const clerkUser = await clerkClient.users.getUser(userId);
                    const email = clerkUser.emailAddresses[0]?.emailAddress;
                    const name = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim() || clerkUser.username || "User";

                    if (email) {
                        // If a user with this email exists under an old ID, clean it up to prevent P2002 unique constraint error
                        const existingByEmail = await prisma.user.findUnique({ where: { email } });
                        if (existingByEmail && existingByEmail.id !== userId) {
                            await prisma.user.update({
                                where: { id: existingByEmail.id },
                                data: { email: `stale_${Date.now()}_${email}` }
                            }).catch(() => {});
                            await prisma.user.delete({ where: { id: existingByEmail.id } }).catch(() => {});
                        }

                        await prisma.user.upsert({
                            where: { id: userId },
                            update: { email, name, image: clerkUser.imageUrl || "" },
                            create: { id: userId, email, name, image: clerkUser.imageUrl || "" },
                        });
                    }
                }

                // Upsert each organization and membership
                for (const m of orgMemberships.data) {
                    const org = m.organization;
                    const role = m.role?.includes("admin") ? "ADMIN" : "MEMBER";

                    await prisma.workspace.upsert({
                        where: { id: org.id },
                        update: { name: org.name, slug: org.slug, image_url: org.imageUrl || "" },
                        create: { id: org.id, name: org.name, slug: org.slug, ownerId: userId, image_url: org.imageUrl || "" }
                    });

                    await prisma.workspaceMember.upsert({
                        where: { userId_workspaceId: { userId, workspaceId: org.id } },
                        update: { role },
                        create: { userId, workspaceId: org.id, role }
                    });
                }

                // Reload workspaces after auto-syncing
                workspaces = await prisma.workspace.findMany({
                    where: { members: { some: { userId: userId } } },
                    include: {
                        members: { include: { user: true } },
                        projects: {
                            include: {
                                tasks: { include: { assignee: true, comments: { include: { user: true } } } },
                                members: { include: { user: true } }
                            }
                        },
                        owner: true,
                    }
                });
            }
        } catch (syncErr) {
            console.error("Clerk organization auto-sync error:", syncErr);
        }

        res.json({ workspaces });
    } catch(error) {
        console.log(error);
        res
            .status(500)
            .json({
                message: error.code || error.message
            });
    }
}

// Add member to workspace
export const addMember = async (req, res) => {
    try {
        const { userId } = await req.auth();
        const { email, role, workspaceId, message } = req.body;

        // check if user exists 
        const user = await prisma.user.findUnique({ where: {email} });
        if(!user) {
            return res
                .status(404)
                .json({ message: "User not found" });
        }

        if(!role || !workspaceId) {
            return res
                .status(400)
                .json({ message: "Missing required parameters" });
        }

        if(!["ADMIN", "MEMBER"].includes(role)){
            return res
                .status(400)
                .json({ message: "Invalid role" });
        }

        // fetch workspace 
        const workspace = await prisma.workspace.findUnique({
            where: {id: workspaceId},
            include: {members: true}
        })

        if(!workspace) {
            return res
                .status(404)
                .json({ message: "Workspace not found" });
        }

        // check creator has admin role
        const isUserAdmin = workspace.members.find((member) => member.userId === userId && member.role === "ADMIN");
        if(!isUserAdmin) {
            return res
                .status(401)
                .json({ message: "You do not have admin privileges" });
        }

        // check if user is already a member 
        const existingMember = workspace.members.find((member) => member.userId === user.id);
        if(existingMember){
            return res
                .status(400)
                .json({ message: "User is already a member" });
        }

        const member = await prisma.workspaceMember.create({
            data: {
                userId: user.id,
                workspaceId,
                role,
                message: message || ""
            }
        })

        res.json({ member, message: "Member added successfully" });

    } catch(error) {
        console.log(error);
        res
            .status(500)
            .json({
                message: error.code || error.message
            });
    }
}