# Filspresso Docs Atlas (Titan V0.74)

This file explains the entire `docs/` folder in one place.

It includes:

- complete document map and purpose
- screenshot gallery embedded from `docs/screenshots/`
- UML gallery embedded from `docs/uml/*.svg`
- security docs summary with explicit runbook intent
- maintenance rules for keeping docs consistent with implementation

## 1. Folder-Level Map

`docs/` currently contains:

1. `screenshots/`

- UI evidence images used for product validation and design history.

2. `uml/`

- Architecture and sequence diagrams (`.mmd` source + `.svg` rendered images).

3. `README.md` (this file)

- Consolidated replacement for previous checklist and security markdown files.

## 2. Security Domains Explained (Consolidated)

1. Deploy-time signature policy

- Admission policy templates and CI drift validation.

2. Incident response

- Detect, contain, verify integrity, archive evidence, and recover.

3. Key lifecycle automation

- Key provider modes, rotation path, lifecycle audit records, and external KMS/HSM boundary.

4. Observability and alerting

- Security telemetry endpoints, severity mapping, and dispatch behavior.

5. Transparency anchoring

- Local anchor persistence plus optional external immutable publication path.

6. Gap-closure backlog

- Remaining Titan V0.74 controls grouped by repo-implementable vs platform-dependent.

## 3. Screenshot Gallery (docs/screenshots)

### Storefront and commerce flow

![Home](screenshots/home.png)
Landing page with hero, navigation, and conversion entry points.

![Coffee](screenshots/coffee.png)
Coffee catalog browsing state.

![Coffee Types](screenshots/coffee_types.png)
Coffee taxonomy and filter segmentation.

![Capsule Amount](screenshots/capsule_amount.png)
Quantity/capsule selection interaction.

![Machines](screenshots/machines.png)
Machine catalog view.

![Favorites](screenshots/favorites.png)
Saved item list and quick-return purchasing.

![Shopping Bag](screenshots/shopping_bag.png)
Cart summary before checkout.

![Payment Page](screenshots/payment_page.png)
Checkout and payment finalization.

### Account and subscription views

![Orders](screenshots/orders.png)
Order history and status visibility.

![Subscription](screenshots/subscription.png)
Subscription enrollment/configuration workflow.

![Subscription Account](screenshots/subscription_account.png)
Account-level subscription lifecycle management.

![Management Account](screenshots/management_account.png)
Account dashboard and user controls.

![Account Machines](screenshots/account_machines.png)
Registered machine management in account scope.

![Member Status 1](screenshots/member_status_1.png)
Membership state view variant A.

![Member Status 2](screenshots/member_status_2.png)
Membership state view variant B.

![Spending Analytics](screenshots/spending_analytics.png)
Spending insights and trend visualization.

![Graphs](screenshots/graphs.png)
Chart-focused analytics presentation.

### Service and legal views

![Services](screenshots/services.png)
Service/support landing content.

![Maintenance](screenshots/maintenance.png)
Maintenance assistance workflow.

![Warranty Repair](screenshots/warranty_repair.png)
Warranty and repair policy/request flow.

![Admin Page](screenshots/admin_page.png)
Privileged management dashboard.

![Privacy Policy](screenshots/privacy_policy.png)
Platform privacy policy page.

![Terms Of Use](screenshots/terms_of_use.png)
Terms/legal framework page.

![Sales And Refunds](screenshots/sales_and_refunds.png)
Commercial policy and refund terms.

### AI assistant views

![Kafelot](screenshots/kafelot.png)
AI assistant product interface.

![Kafelot Policy](screenshots/kafelot_policy.png)
Assistant privacy and usage policy content.

## 4. UML Diagram Gallery (docs/uml)

All UML assets are tracked both as Mermaid source (`.mmd`) and rendered SVG (`.svg`).

1. System context

![System Context Diagram](uml/system-context-diagram.svg)
Source: `uml/system-context-diagram.mmd`

2. Full app deployment

![Full App Deployment Diagram](uml/full-app-deployment-diagram.svg)
Source: `uml/full-app-deployment-diagram.mmd`

3. Full app component diagram

![Full App Component Diagram](uml/full-app-component-diagram.svg)
Source: `uml/full-app-component-diagram.mmd`

4. Full app domain model

![Full App Domain Model](uml/full-app-domain-model.svg)
Source: `uml/full-app-domain-model.mmd`

5. Compose dependency graph

![Compose Dependency Graph](uml/compose-dependency-graph.svg)
Source: `uml/compose-dependency-graph.mmd`

6. Request routing sequence

![Request Routing Sequence](uml/request-routing-sequence.svg)
Source: `uml/request-routing-sequence.mmd`

7. Invoice rendering sequence

![Invoice Rendering Sequence](uml/invoice-rendering-sequence.svg)
Source: `uml/invoice-rendering-sequence.mmd`

8. Security trust boundary

![Security Trust Boundary](uml/security-trust-boundary.svg)
Source: `uml/security-trust-boundary.mmd`

9. Coffee stock read path

![Coffee Stock Read Path](uml/coffee-stock-read-path.svg)
Source: `uml/coffee-stock-read-path.mmd`

10. Stock-safe checkout flow

![Stock Safe Checkout Flow](uml/stock-safe-checkout-flow.svg)
Source: `uml/stock-safe-checkout-flow.mmd`

## 5. Checklist and Backlog Usage

1. Use this file as the consolidated checklist/runbook index for docs scope.
2. Track implementation state changes directly in root and service README files.
3. Keep external platform blockers explicitly marked as external dependencies.

## 6. Docs Maintenance Rules

1. When a route or runtime behavior changes, update:

- this file
- the relevant service README
- matching UML diagrams if topology changed

2. When security behavior changes, update:

- this file security section
- `security/README.md`
- root `README.md` unified atlas section

3. When UI pages change, update:

- screenshot assets
- `SCREENSHOTS.md`
- this gallery section

## 7. Naming Convention

Current architecture label across repository docs is Titan V0.74.
