// app/dashboard/dashboard-client.tsx (Client Component)
'use client';

import { useAuth } from "@clerk/nextjs";
import axios from "axios";

interface DashboardClientProps {
    firstName: string | null;
}

export default function DashboardClient({ firstName }: DashboardClientProps) {
    const { getToken } = useAuth();

    const handleAllocateMachine = async () => {
        try {
            const token = await getToken();
            const baseUrl = process.env.NEXT_PUBLIC_SERVER_BASE_URL;

            if (!baseUrl) {
                throw new Error("Server base URL is not defined in environment variables");
            }

            if (!token) {
                throw new Error("Authentication token is missing");
            }

            const response = await axios.post(`${baseUrl}/api/machines/allocate`, {}, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                withCredentials: true
            });

            if (response.status === 200 && response.data.success) {
                alert("Machine allocated successfully!");
                // Open the allocated machine in a new tab
                const redirectUrl = response.data.data?.redirectUrl;
                if (redirectUrl) {
                    window.open(redirectUrl, '_self');
                }
            } else {
                alert("Failed to allocate machine");
            }
        } catch (error: any) {
            console.error("Error allocating machine:", error);
            if (axios.isAxiosError(error)) {
                alert(`Error: ${error.response?.data?.message || error.message}`);
            } else {
                alert(`Unexpected error: ${error.message}`);
            }
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-6">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                            <p className="text-gray-600">Welcome back, {firstName || "User"}!</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <button
                    onClick={handleAllocateMachine}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                >
                    Allocate the Machine
                </button>
            </main>
        </div>
    );
}