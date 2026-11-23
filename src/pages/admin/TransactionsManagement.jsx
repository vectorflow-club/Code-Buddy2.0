import { Search } from "lucide-react";
import { Pagination } from "../../components/ui";
import { useAdminList } from "../../hooks/useAdminList";
import { formatDate } from "../../utils/formatters";
import { getAdminTransactions } from "../../services/adminDataService";
import "./participants.css";

const PAGE_LIMIT = 20;
const transactionTypes = [
  "STAKE_DEBIT",
  "REWARD_CREDIT",
  "REFUND",
  "SAFE_ZONE_PAYOUT",
  "ADMIN_ADJUSTMENT",
  "ROUND_SETTLEMENT",
];
const emptyFilters = { type: "", levelNumber: "", usn: "", search: "" };

function displayAmount(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : String(value);
}

export default function TransactionsManagement() {
  const {
    items: transactions,
    pagination,
    loading,
    error,
    draftFilters,
    filters,
    handleFilterChange,
    applyFilters,
    clearFilters,
    changePage,
    changeLimit,
    retry,
  } = useAdminList({ fetcher: getAdminTransactions, emptyFilters, resultKey: "transactions", pageLimit: PAGE_LIMIT });

  return (
    <div className="participant-management">
      <div className="participant-page-header">
        <div>
          <span className="admin-eyebrow">COMPETITION MANAGEMENT</span>
          <h1>Transactions.</h1>
          <p>Review the competition transaction ledger.</p>
        </div>
      </div>

      <form onSubmit={applyFilters}>
        <div className="participant-toolbar">
          <div className="participant-search">
            <Search size={18} />
            <input name="search" type="search" placeholder="Search participant name, USN or description..." value={draftFilters.search} onChange={handleFilterChange} maxLength={100} />
          </div>
          <div className="participant-search">
            <input name="usn" type="search" aria-label="Filter by USN" placeholder="Filter by USN..." value={draftFilters.usn} onChange={handleFilterChange} minLength={8} maxLength={15} pattern="[A-Za-z0-9]{8,15}" title="Enter an 8 to 15 character alphanumeric USN" />
          </div>
        </div>
        <div className="participant-toolbar">
          <select name="type" aria-label="Filter by transaction type" value={draftFilters.type} onChange={handleFilterChange}>
            <option value="">All Transaction Types</option>
            {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select name="levelNumber" aria-label="Filter by level" value={draftFilters.levelNumber} onChange={handleFilterChange}>
            <option value="">All Levels</option>
            {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>Level {level}</option>)}
          </select>
          <button className="participant-view-btn" type="submit" disabled={loading}>Apply filters</button>
          <button className="participant-view-btn" type="button" onClick={clearFilters} disabled={loading}>Clear filters</button>
        </div>
      </form>

      {error && (
        <p role="alert">
          {error.message || "Could not load transactions."}
          {error.code ? ` (${error.code})` : ""} {error.status ? `HTTP ${error.status}.` : ""}{" "}
          <button className="participant-view-btn" type="button" onClick={retry} disabled={loading}>Retry</button>
        </p>
      )}
      {loading && <p role="status">Loading transactions…</p>}

      <div className="participant-table-container">
        <div className="participant-table-heading">
          <h2>Transaction Records</h2>
          <span>{pagination ? `${pagination.totalItems} total transactions` : ""}</span>
        </div>
        <div className="participant-table-scroll">
          <table className="participant-table">
            <thead>
              <tr><th>TRANSACTION</th><th>AMOUNT</th><th>LEVEL / ROUND</th><th>DESCRIPTION</th><th>DATE / TIME</th><th>PARTICIPANT</th></tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <strong>{transaction.type || "—"}</strong>
                    <small>{transaction.id || "—"}</small>
                  </td>
                  <td>
                    <strong>{displayAmount(transaction.amount)}</strong>
                    <small>Balance after: {displayAmount(transaction.balanceAfter)}</small>
                  </td>
                  <td>
                    <strong>{transaction.levelNumber == null ? "—" : `Level ${transaction.levelNumber}`}</strong>
                    <small>{transaction.roundId || "—"}</small>
                  </td>
                  <td>{transaction.description || "—"}</td>
                  <td>{formatDate(transaction.timestamp)}</td>
                  <td>
                    <strong>{transaction.participant?.name || "—"}</strong>
                    <small>{transaction.participant?.usn || "—"}</small>
                  </td>
                </tr>
              ))}
              {!loading && !error && transactions.length === 0 && (
                <tr><td colSpan="6" className="participant-empty">No transactions found for the selected filters.</td></tr>
              )}
              {!loading && error && <tr><td colSpan="6" className="participant-empty">Transaction records are unavailable.</td></tr>}
              {loading && <tr><td colSpan="6" className="participant-empty">Loading transactions…</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination pagination={pagination} limit={filters.limit} loading={loading} onPageChange={changePage} onLimitChange={changeLimit} perPageLabel="Transactions per page" />
      </div>
    </div>
  );
}
