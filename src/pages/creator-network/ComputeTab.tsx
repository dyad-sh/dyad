import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FederationClient } from "@/ipc/federation_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Zap,
  RefreshCw,
  Send,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import type {
  FederatedInferenceRoute,
  IpldReceiptRef,
} from "@/types/federation_types";

export default function ComputeTab() {
  const [inferenceForm, setInferenceForm] = useState({
    provider: "ollama" as "ollama" | "lmstudio" | "llamacpp" | "vllm",
    modelId: "",
    prompt: "",
    dataHash: "",
    preferredPeerId: "",
    payerDid: "",
    paymentTxHash: "",
    paymentAmount: "",
    createReceipt: true,
    requireRemote: false,
    privateKey: "",
  });

  const [inferenceOutput, setInferenceOutput] = useState("");
  const [inferenceRoute, setInferenceRoute] = useState<FederatedInferenceRoute | null>(null);
  const [inferenceReceipt, setInferenceReceipt] = useState<IpldReceiptRef | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dispatchLogs, setDispatchLogs] = useState<string[]>([]);

  const { data: identity } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  const { data: connectedPeers = [] } = useQuery({
    queryKey: ["federation-connected-peers"],
    queryFn: () => FederationClient.getConnectedPeers(),
    refetchInterval: 10000,
  });

  const computePeers = connectedPeers.filter((peer) =>
    peer.capabilities.includes("compute")
  );

  useEffect(() => {
    if (identity?.did && !inferenceForm.payerDid) {
      setInferenceForm((prev) => ({ ...prev, payerDid: identity.did }));
    }
  }, [identity, inferenceForm.payerDid]);

  const validateInferenceForm = () => {
    if (!inferenceForm.modelId || !inferenceForm.prompt) {
      toast.error("Model ID and prompt are required");
      return false;
    }
    if (!inferenceForm.payerDid) {
      toast.error("Payer DID is required");
      return false;
    }
    if (inferenceForm.createReceipt && !inferenceForm.dataHash) {
      toast.error("Data hash is required to create a receipt");
      return false;
    }
    if (inferenceForm.requireRemote && !inferenceForm.privateKey) {
      toast.error("Private key is required for remote dispatch");
      return false;
    }
    if (inferenceForm.requireRemote && computePeers.length === 0) {
      toast.error("No compute peers are connected");
      return false;
    }
    return true;
  };

  const executeInferenceMutation = useMutation({
    mutationFn: () => {
      return FederationClient.executeInference({
        provider: inferenceForm.provider,
        model_id: inferenceForm.modelId,
        prompt: inferenceForm.prompt,
        data_hash: inferenceForm.dataHash || undefined,
        preferred_peer_id: inferenceForm.preferredPeerId || undefined,
        payer_did: inferenceForm.payerDid,
        issuer_did: identity?.did,
        payment_tx_hash: inferenceForm.paymentTxHash || undefined,
        payment_amount: inferenceForm.paymentAmount || undefined,
        create_receipt: inferenceForm.createReceipt,
        require_remote: inferenceForm.requireRemote,
        private_key: inferenceForm.privateKey || undefined,
      });
    },
    onSuccess: (result) => {
      setInferenceOutput(result.output || "");
      setInferenceRoute(result.route);
      setInferenceReceipt(result.receipt || null);
      setInferenceError(null);
      setDispatchLogs((prev) => [
        `${new Date().toLocaleTimeString()} • ${result.status.toUpperCase()} • route ${result.route.route_id}`,
        ...prev,
      ]);
      toast.success(result.status === "dispatched" ? "Inference dispatched" : "Inference complete");
    },
    onError: (error) => {
      setInferenceError(error instanceof Error ? error.message : String(error));
      setDispatchLogs((prev) => [
        `${new Date().toLocaleTimeString()} • ERROR • ${error instanceof Error ? error.message : String(error)}`,
        ...prev,
      ]);
      toast.error("Inference failed");
    },
  });

  const handleStreamInference = async () => {
    if (!validateInferenceForm()) return;
    setInferenceOutput("");
    setInferenceRoute(null);
    setInferenceReceipt(null);
    setInferenceError(null);
    setDispatchLogs((prev) => [
      `${new Date().toLocaleTimeString()} • STREAM • started`,
      ...prev,
    ]);
    setIsStreaming(true);

    try {
      await FederationClient.streamInference(
        {
          provider: inferenceForm.provider,
          model_id: inferenceForm.modelId,
          prompt: inferenceForm.prompt,
          data_hash: inferenceForm.dataHash || undefined,
          preferred_peer_id: inferenceForm.preferredPeerId || undefined,
          payer_did: inferenceForm.payerDid,
          issuer_did: identity?.did,
          payment_tx_hash: inferenceForm.paymentTxHash || undefined,
          payment_amount: inferenceForm.paymentAmount || undefined,
          create_receipt: inferenceForm.createReceipt,
          require_remote: inferenceForm.requireRemote,
          private_key: inferenceForm.privateKey || undefined,
        },
        {
          onChunk: (content: string) => {
            setInferenceOutput((prev) => prev + content);
          },
          onDone: (data) => {
            if (data.receipt) setInferenceReceipt(data.receipt);
            setInferenceRoute(data.route);
            setIsStreaming(false);
            setDispatchLogs((prev) => [
              `${new Date().toLocaleTimeString()} • STREAM • done (${data.status})`,
              ...prev,
            ]);
            toast.success("Streaming complete");
          },
          onError: (error: string) => {
            setInferenceError(error);
            setIsStreaming(false);
            setDispatchLogs((prev) => [
              `${new Date().toLocaleTimeString()} • STREAM ERROR • ${error}`,
              ...prev,
            ]);
            toast.error("Streaming failed");
          },
        }
      );
    } catch (error) {
      setInferenceError(error instanceof Error ? error.message : String(error));
      setIsStreaming(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Inference Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                Federated Inference
              </CardTitle>
              <CardDescription>
                Run locally or dispatch to compute peers, with optional IPLD receipts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={inferenceForm.provider}
                    onValueChange={(value) =>
                      setInferenceForm((prev) => ({
                        ...prev,
                        provider: value as "ollama" | "lmstudio" | "llamacpp" | "vllm",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">Ollama</SelectItem>
                      <SelectItem value="lmstudio">LM Studio</SelectItem>
                      <SelectItem value="llamacpp">llama.cpp</SelectItem>
                      <SelectItem value="vllm">vLLM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Model ID</Label>
                  <Input
                    value={inferenceForm.modelId}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, modelId: e.target.value }))
                    }
                    placeholder="model-uuid or local name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Compute Peer</Label>
                  <Select
                    value={inferenceForm.preferredPeerId || "auto"}
                    onValueChange={(value) =>
                      setInferenceForm((prev) => ({
                        ...prev,
                        preferredPeerId: value === "auto" ? "" : value,
                      }))
                    }
                    disabled={computePeers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-select</SelectItem>
                      {computePeers.map((peer) => (
                        <SelectItem key={peer.id} value={peer.id}>
                          {peer.did.display_name || peer.id.slice(0, 12)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payer DID</Label>
                  <Input
                    value={inferenceForm.payerDid}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, payerDid: e.target.value }))
                    }
                    placeholder="did:pkh:eip155:137:0x..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data Hash</Label>
                  <Input
                    value={inferenceForm.dataHash}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, dataHash: e.target.value }))
                    }
                    placeholder="bafy..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Tx (optional)</Label>
                  <Input
                    value={inferenceForm.paymentTxHash}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, paymentTxHash: e.target.value }))
                    }
                    placeholder="0x..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Amount (USDC)</Label>
                  <Input
                    value={inferenceForm.paymentAmount}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, paymentAmount: e.target.value }))
                    }
                    placeholder="10.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dispatch Only</Label>
                  <div className="flex items-center gap-3 pt-1">
                    <Switch
                      checked={inferenceForm.requireRemote}
                      onCheckedChange={(checked) =>
                        setInferenceForm((prev) => ({ ...prev, requireRemote: checked }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      Require remote compute peer
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Private Key (dispatch)</Label>
                  <Input
                    type="password"
                    value={inferenceForm.privateKey}
                    onChange={(e) =>
                      setInferenceForm((prev) => ({ ...prev, privateKey: e.target.value }))
                    }
                    placeholder="Encrypted key or session key"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Create Receipt</Label>
                  <Select
                    value={inferenceForm.createReceipt ? "yes" : "no"}
                    onValueChange={(value) =>
                      setInferenceForm((prev) => ({
                        ...prev,
                        createReceipt: value === "yes",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Prompt</Label>
                <Textarea
                  value={inferenceForm.prompt}
                  onChange={(e) =>
                    setInferenceForm((prev) => ({ ...prev, prompt: e.target.value }))
                  }
                  placeholder="Enter prompt..."
                  rows={6}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    if (!validateInferenceForm()) return;
                    setInferenceOutput("");
                    setInferenceRoute(null);
                    setInferenceReceipt(null);
                    setInferenceError(null);
                    executeInferenceMutation.mutate();
                  }}
                  disabled={executeInferenceMutation.isPending}
                >
                  {executeInferenceMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Run Inference
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleStreamInference}
                  disabled={isStreaming}
                >
                  {isStreaming ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Streaming...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Stream Output
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Results Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Route</CardTitle>
                <CardDescription>Selected compute target and required chunks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {inferenceRoute ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        Target:{" "}
                        <span className="font-medium">
                          {inferenceRoute.target.display_name || inferenceRoute.target.did}
                        </span>
                      </div>
                      {inferenceForm.requireRemote && (
                        <Badge className="bg-amber-500 text-white">Remote-only</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Capability: {inferenceRoute.target.capability}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Required Chunks: {inferenceRoute.required_chunks.length}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Run an inference to see routing details.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Receipt</CardTitle>
                <CardDescription>IPLD receipt reference (if enabled).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {inferenceReceipt ? (
                  <>
                    <div className="text-xs text-muted-foreground">CID</div>
                    <div className="font-mono text-xs break-all">{inferenceReceipt.cid}</div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(inferenceReceipt.cid)}
                    >
                      <Copy className="w-3 h-3 mr-2" />
                      Copy CID
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No receipt created yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Output</CardTitle>
                <CardDescription>Streaming or completed response.</CardDescription>
              </CardHeader>
              <CardContent>
                {inferenceError ? (
                  <p className="text-sm text-red-500">{inferenceError}</p>
                ) : inferenceOutput ? (
                  <pre className="text-xs whitespace-pre-wrap">{inferenceOutput}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Output will appear here.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Dispatch Log</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDispatchLogs([])}
                    disabled={dispatchLogs.length === 0}
                  >
                    Clear
                  </Button>
                </div>
                <CardDescription>Recent routing and dispatch events.</CardDescription>
              </CardHeader>
              <CardContent>
                {dispatchLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No dispatch events yet.</p>
                ) : (
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {dispatchLogs.slice(0, 8).map((entry, index) => (
                      <div key={`${entry}-${index}`} className="font-mono">
                        {entry}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
