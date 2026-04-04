import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FederationClient } from "@/ipc/federation_client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle2,
  ArrowRightLeft,
} from "lucide-react";

export default function EarningsTab() {
  const { data: identity } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["federation-transactions"],
    queryFn: () => FederationClient.getTransactions(),
  });

  // Calculate earnings from transactions where this identity is the seller
  const earnings = useMemo(() => {
    if (!identity?.did) return { totalEarned: 0, pendingEscrow: 0, totalCount: 0, currency: "USDC" };

    let totalEarned = 0;
    let pendingEscrow = 0;
    let totalCount = 0;

    for (const tx of transactions) {
      if (tx.seller.did === identity.did) {
        totalCount++;
        if (tx.status === "completed" || tx.status === "confirmed") {
          totalEarned += tx.amount;
        } else if (
          tx.status === "payment-in-escrow" ||
          tx.status === "delivering" ||
          tx.status === "delivered"
        ) {
          pendingEscrow += tx.amount;
        }
      }
    }

    return {
      totalEarned,
      pendingEscrow,
      totalCount,
      currency: transactions[0]?.currency.symbol || "USDC",
    };
  }, [identity?.did, transactions]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
      case "confirmed":
        return "bg-green-500";
      case "initiated":
      case "awaiting-payment":
        return "bg-yellow-500";
      case "payment-in-escrow":
      case "delivering":
      case "delivered":
        return "bg-blue-500";
      case "disputed":
        return "bg-red-500";
      case "refunded":
      case "cancelled":
      case "expired":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Earnings Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <DollarSign className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {earnings.totalEarned.toFixed(2)} {earnings.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Earned</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                  <Clock className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {earnings.pendingEscrow.toFixed(2)} {earnings.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">Pending in Escrow</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
                  <ArrowRightLeft className="w-5 h-5 text-cyan-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{earnings.totalCount}</p>
                  <p className="text-xs text-muted-foreground">Total Transactions (as seller)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-cyan-500" />
              Transaction History
            </CardTitle>
            <CardDescription>
              All transactions on the creator network ({transactions.length})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No transactions yet. Browse and purchase assets to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => {
                    const isSeller = tx.seller.did === identity?.did;
                    const counterparty = isSeller ? tx.buyer : tx.seller;
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono text-xs">
                          {tx.id.slice(0, 12)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {tx.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              {counterparty.display_name || counterparty.did.slice(0, 16)}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {isSeller ? "buyer" : "seller"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {isSeller ? "+" : "-"}
                          {tx.amount} {tx.currency.symbol}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getStatusColor(tx.status)}`} />
                            <span className="text-xs capitalize">
                              {tx.status.replace(/-/g, " ")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(tx.initiated_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
