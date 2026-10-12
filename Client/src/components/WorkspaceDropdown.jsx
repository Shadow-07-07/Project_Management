import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Plus } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { setCurrentWorkspace } from "../features/workspaceSlice";
import { useNavigate } from "react-router-dom"; 
import { useClerk, useOrganization, useOrganizationList } from "@clerk/react";

function WorkspaceDropdown() {
    const { organization } = useOrganization();
    const { setActive, userMemberships, isLoaded } = useOrganizationList({
        userMemberships: { infinite: true }
    });
    const { openCreateOrganization } = useClerk();

    const { workspaces } = useSelector((state) => state.workspace);
    const currentWorkspace = useSelector((state) => state.workspace?.currentWorkspace || null);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const onSelectWorkspace = async (organizationId) => {
        if (organization?.id !== organizationId && setActive) {
            await setActive({ organization: organizationId });
        }
        dispatch(setCurrentWorkspace(organizationId));
        setIsOpen(false);
        navigate('/');
    };

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // When Clerk active organization changes (e.g. after creating or switching an org), sync to Redux
    useEffect(() => {
        if (organization?.id && currentWorkspace?.id !== organization.id) {
            const match = workspaces.find((w) => w.id === organization.id);
            if (match) {
                dispatch(setCurrentWorkspace(organization.id));
            }
        }
    }, [organization?.id, currentWorkspace?.id, workspaces, dispatch]);

    // Workspaces to display: prioritize Redux workspaces (contains DB relations), or Clerk memberships
    const workspaceList = workspaces.length > 0 
        ? workspaces 
        : (userMemberships?.data?.map((m) => m.organization).filter(Boolean) || []);

    return (
        <div className="relative m-4" ref={dropdownRef}>
            <button onClick={() => setIsOpen(prev => !prev)} className="w-full flex items-center justify-between p-3 h-auto text-left rounded hover:bg-gray-100 dark:hover:bg-zinc-800" >
                <div className="flex items-center gap-3">
                    {currentWorkspace?.image_url ? (
                        <img src={currentWorkspace.image_url} alt={currentWorkspace.name} className="w-8 h-8 rounded shadow object-cover" />
                    ) : (
                        <div className="w-8 h-8 rounded shadow bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                            {currentWorkspace?.name?.[0]?.toUpperCase() || "W"}
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-800 dark:text-white text-sm truncate">
                            {currentWorkspace?.name || "Select Workspace"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                            {workspaceList.length} workspace{workspaceList.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-zinc-400 flex-shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-64 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded shadow-lg top-full left-0">
                    <div className="p-2">
                        <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2 px-2">
                            Workspaces
                        </p>
                        {workspaceList.map((ws) => {
                            const orgId = ws.id;
                            const orgName = ws.name || "Workspace";
                            const orgImage = ws.image_url || ws.imageUrl || "";
                            const memberCount = ws.members?.length || ws.membersCount || 1;
                            const isSelected = currentWorkspace?.id === orgId;

                            return (
                                <div key={orgId} onClick={() => onSelectWorkspace(orgId)} className="flex items-center gap-3 p-2 cursor-pointer rounded hover:bg-gray-100 dark:hover:bg-zinc-800" >
                                    {orgImage ? (
                                        <img src={orgImage} alt={orgName} className="w-6 h-6 rounded object-cover" />
                                    ) : (
                                        <div className="w-6 h-6 rounded bg-blue-600 text-white text-xs flex items-center justify-center font-bold">
                                            {orgName?.[0]?.toUpperCase() || "W"}
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                                            {orgName}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                                            {memberCount} member{memberCount !== 1 ? "s" : ""}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <hr className="border-gray-200 dark:border-zinc-700" />

                    <div 
                        onClick={() => {
                            openCreateOrganization(); 
                            setIsOpen(false);
                        }} 
                        className="p-2 cursor-pointer rounded group hover:bg-gray-100 dark:hover:bg-zinc-800"
                    >
                        <p className="flex items-center text-xs gap-2 my-1 w-full text-blue-600 dark:text-blue-400 group-hover:text-blue-500 dark:group-hover:text-blue-300">
                            <Plus className="w-4 h-4" /> Create Workspace
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default WorkspaceDropdown;

