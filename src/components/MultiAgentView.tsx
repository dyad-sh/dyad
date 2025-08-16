import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { IpcClient } from "../ipc/ipc_client";
import { useAtom } from "jotai";
import { selectedAppIdAtom } from "../atoms/appAtoms";
import { ConversationTurn } from "../multi_agent/Orchestrator";
import { useEffect } from "react";

export function MultiAgentView() {
  const [task, setTask] = useState("");
  const [conversationHistory, setConversationHistory] = useState<
    ConversationTurn[]
  >([]);
  const [finalCode, setFinalCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const [trainingStatus, setTrainingStatus] = useState("");

  const handleRun = async () => {
    if (!task || !selectedAppId) return;
    setIsLoading(true);
    setConversationHistory([]);
    setFinalCode("");
    setError("");

    const result = await IpcClient.getInstance().runMultiAgent(
      task,
      selectedAppId,
    );

    if (result.success) {
      setConversationHistory(result.conversationHistory || []);
      setFinalCode(result.finalCode || "");
    } else {
      setError(result.error || "An unknown error occurred.");
    }

    setIsLoading(false);
  };

  const handleTrain = async () => {
    const result = await IpcClient.getInstance().trainAgent();
    if (result.success) {
      setTrainingStatus("Training started...");
    } else {
      setError(result.error || "Failed to start training.");
    }
  };

  useEffect(() => {
    IpcClient.getInstance().startPythonService();

    const interval = setInterval(async () => {
      const result = await IpcClient.getInstance().getTrainingStatus();
      if (result.success) {
        setTrainingStatus(result.data.status);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      IpcClient.getInstance().stopPythonService();
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multi-Agent Code Generation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Input
            placeholder="Enter your request..."
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <Button onClick={handleRun} disabled={isLoading}>
            {isLoading ? "Running..." : "Run"}
          </Button>
          <Button onClick={handleTrain} disabled={isLoading}>
            Train Agents
          </Button>
          {trainingStatus && <p>Training Status: {trainingStatus}</p>}
          {error && <p className="text-red-500">{error}</p>}
          <div className="space-y-4">
            {conversationHistory.map((turn, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle>{turn.agentName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-bold">Thoughts:</p>
                  <pre className="p-2 bg-gray-100 rounded-md">
                    {turn.thoughts}
                  </pre>
                  <p className="mt-2 font-bold">Output:</p>
                  <pre className="p-2 bg-gray-100 rounded-md">
                    <code>{turn.output}</code>
                  </pre>
                </CardContent>
              </Card>
            ))}
          </div>
          {finalCode && (
            <div>
              <h3 className="text-lg font-bold mt-4">Final Code:</h3>
              <pre className="p-4 bg-gray-800 text-white rounded-md">
                <code>{finalCode}</code>
              </pre>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
