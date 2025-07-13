// app/dashboard/dashboard-client.tsx (Client Component)
'use client';

import { useAuth } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Terminal,
    Server,
    Clock,
    AlertCircle,
    CheckCircle2,
    Loader2,
    ExternalLink,
    RefreshCw,
    Activity,
    Users,
    HardDrive
} from "lucide-react";

interface DashboardClientProps {
    firstName: string | null;
}

interface WorkspaceData {
    instanceId: string;
    publicUrl: string;
    state: 'RUNNING' | 'STOPPED';
    lastSeen?: string;
    ts?: string;
}

interface SystemStatus {
    activeUsers: number;
    warmSpares: number;
    totalInstances: number;
    asgCapacity: number;
}

type WorkspaceStatus = 'idle' | 'loading' | 'running' | 'processing' | 'error';

export default function DashboardClient({ firstName }: DashboardClientProps) {
    const { getToken } = useAuth();
    const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>('idle');
    const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    const baseUrl = process.env.NEXT_PUBLIC_SERVER_BASE_URL;

    // Fetch system status
    const fetchSystemStatus = async () => {
        try {
            const response = await axios.get(`${baseUrl}/api/status`);
            if (response.data.success) {
                setSystemStatus(response.data.data);
            }
        } catch (error) {
            console.error("Failed to fetch system status:", error);
        }
    };

    // Check existing workspace
    const checkWorkspaceStatus = async () => {
        try {
            const token = await getToken();
            if (!token) return;

            const response = await axios.get(`${baseUrl}/api/v1/machines/status`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                withCredentials: true
            });

            if (response.data.success && response.data.data) {
                setWorkspaceData({
                    instanceId: response.data.data.instanceId,
                    publicUrl: response.data.data.publicUrl,
                    state: response.data.data.state,
                    lastSeen: response.data.data.lastSeen,
                    ts: response.data.data.ts
                });
                setWorkspaceStatus('running');
            }
        } catch (error) {
            // If no existing workspace, that's fine
            console.log("No existing workspace found");
        }
    };

    // Handle machine allocation
    const handleAllocateMachine = async () => {
        setError(null);
        setWorkspaceStatus('loading');

        try {
            const token = await getToken();
            if (!baseUrl) {
                throw new Error("Server base URL is not defined");
            }
            if (!token) {
                throw new Error("Authentication token is missing");
            }

            const response = await axios.post(`${baseUrl}/api/v1/machines/allocate`, {}, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                withCredentials: true
            });

            if (response.status === 200 && response.data.success) {
                setWorkspaceData({
                    instanceId: response.data.data.instanceId,
                    publicUrl: response.data.data.publicUrl,
                    state: 'RUNNING'
                });
                setWorkspaceStatus('running');
            } else if (response.status === 202 && response.data.status === 'processing') {
                setWorkspaceStatus('processing');
                setError(response.data.message);
                // Start polling for availability
                startPolling();
            } else {
                setWorkspaceStatus('error');
                setError(response.data.message || 'Failed to allocate machine');
            }
        } catch (error: any) {
            setWorkspaceStatus('error');
            if (axios.isAxiosError(error)) {
                setError(error.response?.data?.message || error.message);
            } else {
                setError(error.message || 'Unexpected error occurred');
            }
        }
    };

    // Start polling for machine availability
    const startPolling = () => {
        if (isPolling) return;

        setIsPolling(true);
        const pollInterval = setInterval(async () => {
            try {
                const token = await getToken();
                if (!token) return;

                const response = await axios.post(`${baseUrl}/api/v1/machines/allocate`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    withCredentials: true
                });

                if (response.data.success) {
                    setWorkspaceData({
                        instanceId: response.data.data.instanceId,
                        publicUrl: response.data.data.publicUrl,
                        state: 'RUNNING'
                    });
                    setWorkspaceStatus('running');
                    setError(null);
                    clearInterval(pollInterval);
                    setIsPolling(false);
                }
            } catch (error) {
                // Continue polling
            }
        }, 30000); // Poll every 5 seconds

        // Stop polling after 2 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            setIsPolling(false);
            if (workspaceStatus === 'processing') {
                setWorkspaceStatus('error');
                setError('Timeout: Machine allocation took too long. Please try again.');
            }
        }, 120000);
    };

    // Open workspace
    const openWorkspace = () => {
        if (workspaceData?.publicUrl) {
            window.open(`http://${workspaceData.publicUrl}`, '_blank');
        }
    };

    // Refresh data
    const refreshData = () => {
        fetchSystemStatus();
        checkWorkspaceStatus();
    };

    // Initial data fetch
    useEffect(() => {
        fetchSystemStatus();
        checkWorkspaceStatus();

        // Refresh system status every 10 minutes   
        const interval = setInterval(fetchSystemStatus, 600000);
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = (status: WorkspaceStatus) => {
        switch (status) {
            case 'running': return 'bg-green-500';
            case 'loading': return 'bg-blue-500';
            case 'processing': return 'bg-yellow-500';
            case 'error': return 'bg-red-500';
            default: return 'bg-gray-500';
        }
    };

    const getStatusText = (status: WorkspaceStatus) => {
        switch (status) {
            case 'running': return 'Active';
            case 'loading': return 'Starting...';
            case 'processing': return 'Scaling Up...';
            case 'error': return 'Error';
            default: return 'Not Started';
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-6">
                        <div className="flex items-center space-x-3">
                            <Terminal className="h-8 w-8 text-blue-600" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Code Server Dashboard</h1>
                                <p className="text-slate-600">Welcome back, {firstName || "Developer"}!</p>
                            </div>
                        </div>
                        <Button
                            onClick={refreshData}
                            variant="outline"
                            size="sm"
                            className="flex items-center space-x-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            <span>Refresh</span>
                        </Button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* System Status Cards */}
                {systemStatus && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Active Users</CardTitle>
                                <Users className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{systemStatus.activeUsers}</div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Warm Spares</CardTitle>
                                <Server className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{systemStatus.warmSpares}</div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Instances</CardTitle>
                                <HardDrive className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{systemStatus.totalInstances}</div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">ASG Capacity</CardTitle>
                                <Activity className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{systemStatus.asgCapacity}</div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Workspace Management */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Workspace Status */}
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2">
                                <Terminal className="h-5 w-5" />
                                <span>Your Workspace</span>
                                <Badge
                                    variant="secondary"
                                    className={`ml-auto ${getStatusColor(workspaceStatus)} text-white`}
                                >
                                    {getStatusText(workspaceStatus)}
                                </Badge>
                            </CardTitle>
                            <CardDescription>
                                Manage your VS Code workspace in the cloud
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {workspaceStatus === 'idle' && (
                                <div className="text-center py-8">
                                    <Server className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                                    <p className="text-slate-600 mb-4">No active workspace</p>
                                    <Button
                                        onClick={handleAllocateMachine}
                                        className="w-full"
                                        size="lg"
                                    >
                                        <Terminal className="h-4 w-4 mr-2" />
                                        Start New Workspace
                                    </Button>
                                </div>
                            )}

                            {workspaceStatus === 'loading' && (
                                <div className="text-center py-8">
                                    <Loader2 className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-spin" />
                                    <p className="text-slate-600 mb-2">Starting your workspace...</p>
                                    <p className="text-sm text-slate-500">This usually takes 30-60 seconds</p>
                                </div>
                            )}

                            {workspaceStatus === 'processing' && (
                                <div className="text-center py-8">
                                    <Clock className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                                    <p className="text-slate-600 mb-2">Scaling up infrastructure...</p>
                                    <p className="text-sm text-slate-500">No warm spares available, launching new instance</p>
                                    <Button
                                        onClick={handleAllocateMachine}
                                        variant="outline"
                                        className="mt-4"
                                        disabled={isPolling}
                                    >
                                        {isPolling ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Checking...
                                            </>
                                        ) : (
                                            'Retry'
                                        )}
                                    </Button>
                                </div>
                            )}

                            {workspaceStatus === 'running' && workspaceData && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-center py-4">
                                        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-slate-600 mb-4">Your workspace is ready!</p>
                                        <Button
                                            onClick={openWorkspace}
                                            className="w-full"
                                            size="lg"
                                        >
                                            <ExternalLink className="h-4 w-4 mr-2" />
                                            Open VS Code
                                        </Button>
                                    </div>
                                    <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                                        <div className="text-sm space-y-1">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Instance ID:</span>
                                                <span className="font-mono text-xs">{workspaceData.instanceId}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Public IP:</span>
                                                <span className="font-mono text-xs">{workspaceData.publicUrl}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Status:</span>
                                                <Badge variant="secondary" className="bg-green-100 text-green-800">
                                                    {workspaceData.state}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {workspaceStatus === 'error' && (
                                <div className="text-center py-8">
                                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                                    <p className="text-slate-600 mb-2">Failed to start workspace</p>
                                    {error && (
                                        <p className="text-sm text-red-600 mb-4 bg-red-50 p-3 rounded-lg">
                                            {error}
                                        </p>
                                    )}
                                    <Button
                                        onClick={handleAllocateMachine}
                                        variant="outline"
                                        className="mt-2"
                                    >
                                        Try Again
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Information Panel */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2">
                                <Activity className="h-5 w-5" />
                                <span>System Information</span>
                            </CardTitle>
                            <CardDescription>
                                Current system status and information
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                                    <div className="flex items-center space-x-3">
                                        <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                                        <span className="text-sm font-medium">Auto-scaling enabled</span>
                                    </div>
                                    <Badge variant="secondary">Active</Badge>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                                    <div className="flex items-center space-x-3">
                                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                                        <span className="text-sm font-medium">Idle cleanup enabled</span>
                                    </div>
                                    <Badge variant="secondary">5 min timeout</Badge>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                                    <div className="flex items-center space-x-3">
                                        <div className="h-2 w-2 bg-yellow-500 rounded-full"></div>
                                        <span className="text-sm font-medium">Warm spare pool</span>
                                    </div>
                                    <Badge variant="secondary">
                                        {systemStatus?.warmSpares || 0} available
                                    </Badge>
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                                <h4 className="font-medium text-slate-900 mb-2">Getting Started</h4>
                                <ul className="text-sm text-slate-600 space-y-1">
                                    <li>• Click "Start New Workspace" to launch VS Code</li>
                                    <li>• Your workspace will auto-stop after 5 minutes of inactivity</li>
                                    <li>• Files are persistent across sessions</li>
                                    <li>• Use the heartbeat system to keep your session alive</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}