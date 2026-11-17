/** Sample documents. Every name, company, number and address here is fictional. */
export interface Sample {
  id: string;
  label: string;
  hint: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'contract',
    label: 'Freelance contract',
    hint: 'Find the one-sided clauses',
    text: `FREELANCE SERVICES AGREEMENT

This Agreement is made on 3 November 2026 between Meridian Outfitters Inc. ("Client"), 418 Alder Street, Portland, Oregon, and Priya Raman ("Contractor"), trading as Harbor & Finch Studio Ltd.

1. Scope. Contractor will redesign the Client's online store and deliver a component library by 15 January 2027. Day-to-day contact for the Client is Mr. Daniel Okafor (daniel.okafor@meridian-outfitters.example, +1 (415) 555-0134).

2. Fees. Client will pay a fixed fee of $18,500, invoiced as $7,400 on signature and $11,100 on final delivery. Invoices are payable within 75 days of receipt. Late payments accrue no interest.

3. Revisions. Contractor will provide unlimited revisions until Client confirms in writing that it is satisfied.

4. Intellectual property. All work product, including preliminary concepts and unused drafts, is assigned to Client upon creation, whether or not the related invoice has been paid.

5. Termination. Client may terminate at any time without notice and without payment for work in progress. Contractor may terminate only with 60 days' written notice.

6. Liability. Contractor's liability under this Agreement is unlimited. Client's total liability is capped at $500.

7. Non-compete. For 24 months after termination, Contractor will not provide design services to any retail business in North America.

Payments to: Harbor & Finch Studio Ltd, IBAN GB29 NWBK 6016 1331 9268 19, reference contract no. MO-2026-0417.

Signed,
Daniel Okafor, for Meridian Outfitters Inc.
Priya Raman, for Harbor & Finch Studio Ltd`,
  },
  {
    id: 'email',
    label: 'Awkward client email',
    hint: 'Draft a firm, polite reply',
    text: `Subject: Re: Invoice INV-20931 overdue

Hi Tomas,

I'm following up again on invoice no. INV-20931 for $6,240, which was due on 2 October. That makes it 47 days late. I did see the partial transfer of $1,500 from Castellan Robotics GmbH on 28 October, thank you for that, but the remaining $4,740 is still open.

When we spoke on the phone, Ingrid Sauer from your finance team said the delay was caused by a change of bank details on your side. For the record, our details have not changed: account 004417820963 at First Cascade Bank, in the name of Linden Analytics LLC.

I'd rather not pause the dashboard work for your Hamburg warehouse, but I can't keep two people on it without payment. Could you confirm a payment date by Friday? You can reach me on +1 (503) 555-0188 or at mara.voss@linden-analytics.example.

Best regards,
Mara Voss
Linden Analytics LLC`,
  },
  {
    id: 'statement',
    label: 'Bank statement',
    hint: 'Summarize where the money went',
    text: `FIRST CASCADE BANK - ACCOUNT STATEMENT
Account holder: Jonah Whitfield
Account number: 730055219846
Card ending: 4539 1488 0343 6467
Statement period: 1 October 2026 to 31 October 2026

Date        Description                               Amount
01 Oct      Salary - Brightwater Logistics Ltd        +$4,850.00
02 Oct      Rent - Elm Court Properties LLC           -$1,720.00
04 Oct      Grocery - Fernhill Market                 -$142.36
07 Oct      Transfer to Aiko Whitfield                -$600.00
09 Oct      Pharmacy - Wellspring Chemist             -$38.90
12 Oct      Streaming subscription                    -$15.99
15 Oct      Dr. Elena Marchetti - consultation        -$210.00
18 Oct      Electricity - Cascade Power Corp          -$96.14
21 Oct      Restaurant - The Copper Kettle            -$74.50
25 Oct      Car loan - Northgate Auto Finance Inc     -$389.00
28 Oct      Transfer from Aiko Whitfield              +$250.00
30 Oct      Savings transfer                          -$800.00

Closing balance: $2,163.11
Questions? Call +1 (800) 555-0199 or write to help@firstcascade.example`,
  },
];
