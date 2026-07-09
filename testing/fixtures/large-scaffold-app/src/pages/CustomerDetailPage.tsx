import { useParams } from "react-router-dom";
import { CustomerHealth } from "@/components/customers/CustomerHealth";
import { CustomerNotes } from "@/components/customers/CustomerNotes";
import { CustomerRenewals } from "@/components/customers/CustomerRenewals";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency } from "@/lib/format";
import { useCustomer, useCustomers } from "@/hooks/useOpsQueries";

export default function CustomerDetailPage() {
  const { id = "" } = useParams();
  const customer = useCustomer(id);
  const customers = useCustomers();
  const item = customer.data;
  return (
    <>
      <PageHeader title={item?.name ?? "Customer detail"} description={item ? `${formatCurrency(item.arr)} ARR account owned by ${item.accountOwner}.` : "Detailed customer route for fixture navigation."} />
      <section className="grid gap-4 lg:grid-cols-3">
        <CustomerHealth items={item ? [item] : []} />
        <CustomerRenewals items={customers.data ?? []} compact />
        <CustomerNotes items={item ? [item] : []} />
      </section>
    </>
  );
}
