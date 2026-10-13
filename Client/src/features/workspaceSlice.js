import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"; 
import api from '../configs/api.js';

export const fetchWorkspaces = createAsyncThunk('workspace/fetchWorkspaces', async ({getToken, activeOrgId}) => {
    try {
        const {data} = await api.get('/api/workspaces', {headers: {Authorization: `Bearer ${await getToken()}`}})
        return { workspaces: data.workspaces || [], activeOrgId }
    } catch (error) {
        console.log(error?.response?.data?.message || error.message)
        return { workspaces: [], activeOrgId: null }
    }
})

const initialState = {
    workspaces: [],
    currentWorkspace: null,
    loading: false,
};

const workspaceSlice = createSlice({
    name: "workspace",
    initialState,
    reducers: {
        setWorkspaces: (state, action) => {
            state.workspaces = action.payload;
        },
        setCurrentWorkspace: (state, action) => {
            localStorage.setItem("currentWorkspaceId", action.payload);
            state.currentWorkspace = state.workspaces.find((w) => w.id === action.payload);
        },
        addWorkspace: (state, action) => {
            state.workspaces.push(action.payload);

            // set current workspace to the new workspace
            if (state.currentWorkspace?.id !== action.payload.id) {
                state.currentWorkspace = action.payload;
            }
        },
        updateWorkspace: (state, action) => {
            state.workspaces = state.workspaces.map((w) =>
                w.id === action.payload.id ? action.payload : w
            );

            // if current workspace is updated, set it to the updated workspace
            if (state.currentWorkspace?.id === action.payload.id) {
                state.currentWorkspace = action.payload;
            }
        },
        deleteWorkspace: (state, action) => {
            state.workspaces = state.workspaces.filter((w) => w._id !== action.payload);
        },
        addProject: (state, action) => {
            if (state.currentWorkspace) {
                if (!state.currentWorkspace.projects) {
                    state.currentWorkspace.projects = [];
                }
                const exists = state.currentWorkspace.projects.some((p) => p.id === action.payload.id);
                if (!exists) {
                    state.currentWorkspace.projects.push(action.payload);
                }
            }
            state.workspaces = state.workspaces.map((w) => {
                if (w.id === state.currentWorkspace?.id) {
                    const currentProjects = w.projects || [];
                    const exists = currentProjects.some((p) => p.id === action.payload.id);
                    return {
                        ...w,
                        projects: exists ? currentProjects : [...currentProjects, action.payload]
                    };
                }
                return w;
            });
        },
        updateProject: (state, action) => {
            const updated = action.payload;
            if (state.currentWorkspace && state.currentWorkspace.projects) {
                state.currentWorkspace.projects = state.currentWorkspace.projects.map((p) =>
                    p.id === updated.id ? { ...p, ...updated } : p
                );
            }
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace?.id ? {
                    ...w,
                    projects: (w.projects || []).map((p) =>
                        p.id === updated.id ? { ...p, ...updated } : p
                    )
                } : w
            );
        },
        addTask: (state, action) => {
            const task = action.payload;
            if (state.currentWorkspace && state.currentWorkspace.projects) {
                state.currentWorkspace.projects = state.currentWorkspace.projects.map((p) => {
                    if (p.id === task.projectId) {
                        return {
                            ...p,
                            tasks: (p.tasks || []).concat(task)
                        };
                    }
                    return p;
                });
            }

            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace?.id ? {
                    ...w,
                    projects: (w.projects || []).map((p) =>
                        p.id === task.projectId ? {
                            ...p,
                            tasks: (p.tasks || []).concat(task)
                        } : p
                    )
                } : w
            );
        },
        updateTask: (state, action) => {
            state.currentWorkspace.projects.map((p) => {
                if (p.id === action.payload.projectId) {
                    p.tasks = p.tasks.map((t) =>
                        t.id === action.payload.id ? action.payload : t
                    );
                }
            });
            // find workspace and project by id and update task in it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? {
                            ...p, tasks: p.tasks.map((t) =>
                                t.id === action.payload.id ? action.payload : t
                            )
                        } : p
                    )
                } : w
            );
        },
        deleteTask: (state, action) => {
            const deletedTaskIds = new Set(action.payload);
            const removeDeletedTasks = (workspace) => ({
                ...workspace,
                projects: workspace.projects.map((project) => ({
                    ...project,
                    tasks: project.tasks.filter((task) => !deletedTaskIds.has(task.id))
                }))
            });

            if (state.currentWorkspace) {
                state.currentWorkspace = removeDeletedTasks(state.currentWorkspace);
            }
            state.workspaces = state.workspaces.map((workspace) =>
                workspace.id === state.currentWorkspace?.id
                    ? removeDeletedTasks(workspace)
                    : workspace
            );
        }

    },
    extraReducers: (builder) => {
        builder.addCase(fetchWorkspaces.pending, (state) => {
            state.loading = true
        });
        builder.addCase(fetchWorkspaces.fulfilled, (state, action) => {
            const { workspaces, activeOrgId } = action.payload;
            state.workspaces = workspaces;
            if(workspaces.length > 0) {
                // If Clerk has an active organization, prioritize it
                const activeMatch = activeOrgId ? workspaces.find(w => w.id === activeOrgId) : null;
                if (activeMatch) {
                    state.currentWorkspace = activeMatch;
                    localStorage.setItem("currentWorkspaceId", activeMatch.id);
                } else {
                    const localStorageCurrentworkspaceId = localStorage.getItem("currentWorkspaceId");
                    if(localStorageCurrentworkspaceId) {
                        const findWorkspace = workspaces.find((w) => w.id === localStorageCurrentworkspaceId);
                        if(findWorkspace) {
                            state.currentWorkspace = findWorkspace;
                        }
                        else{
                            state.currentWorkspace = workspaces[0];
                            localStorage.setItem("currentWorkspaceId", workspaces[0].id);
                        }
                    }
                    else{
                        state.currentWorkspace = workspaces[0];
                        localStorage.setItem("currentWorkspaceId", workspaces[0].id);
                    }
                }
            }
            state.loading = false;
        });
        builder.addCase(fetchWorkspaces.rejected, (state) => {
            state.loading = false;
        });
    }
});

export const { setWorkspaces, setCurrentWorkspace, addWorkspace, updateWorkspace, deleteWorkspace, addProject, updateProject, addTask, updateTask, deleteTask } = workspaceSlice.actions;
export default workspaceSlice.reducer;