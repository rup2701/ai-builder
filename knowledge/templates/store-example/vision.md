# Vision: Handmade Goods Store

## Purpose

Build a polished, responsive online store for a small independent seller of handmade goods.

The store should help shoppers discover distinctive products, understand their materials and craftsmanship, personalize eligible items, and complete a straightforward purchase journey.

This application is a benchmark for AI Builder. The goal is to evaluate how well an AI coding workflow translates a product specification into a coherent, usable application—not to reproduce Etsy or any other existing store.

## Target Users

- **Shopper:** Browses handmade products, explores product details and options, adds products to a cart, and completes a demo checkout.
- **Store owner:** Provides the product catalog and product information. A seller dashboard is outside the scope of this benchmark.

## Core User Journey

1. Discover products on a welcoming storefront.
2. Browse and filter the catalog.
3. Open a product detail page and understand its images, description, price, availability, and options.
4. Configure a product and add it to the cart.
5. Review the cart and modify quantities or remove items.
6. Enter checkout details and receive an order confirmation.

## Product Principles

- Put product photography and craftsmanship at the center of the experience.
- Make available actions and product options obvious.
- Provide clear feedback after important actions, such as adding an item to the cart.
- Prevent unavailable product configurations from being purchased.
- Keep the experience usable on mobile, tablet, and desktop.
- Use accessible labels, semantic structure, visible focus states, and readable contrast.
- Prefer sensible defaults over asking shoppers unnecessary questions.
- Keep product information and purchase state consistent across pages.

## Benchmark Scope

The application should include:

- A home page introducing the store.
- A product catalog.
- Product detail pages.
- Product variants, where applicable.
- Optional product personalization, where applicable.
- A shopping cart.
- A simulated checkout.
- An order confirmation page.
- A returns and refunds policy page. *(CR-001)*
- A site footer and subfooter with help, contact and accepted-payment information, plus Help and Contact pages. *(CR-002)*
- Browsing pages (home, catalog, product, header, footer) use the full screen width. *(CR-003)*
- Product cards put the image first, with minimal frame, padding and text. *(CR-004)*
- A row of four reassurances (makers, returns, shipping, contact) sits at the bottom of the home page, just above the footer. *(CR-005)*

## Constraints and Assumptions

- Use an original store name, visual identity, copy, and product data.
- Do not copy Etsy's branding, proprietary assets, or exact page designs.
- This is a front-end demonstration, not a production commerce system.
- Checkout must be explicitly simulated. Do not collect or transmit real payment information.
- Authentication, seller dashboards, real payment processing, shipping-rate integrations, tax services, and fulfillment integrations are out of scope.
- Static or local product data is acceptable.
- Cart state should persist while navigating between pages. Browser-local persistence is acceptable.
- Prices are represented in USD.
- Any shipping or tax amounts shown must be clearly identified as estimates or demo values.
- Personalization is supported only for products that explicitly allow it.

## Definition of Success

A shopper can complete the core journey—from discovering a product to receiving a demo order confirmation—without broken navigation, invalid product configurations, inconsistent totals, or confusing state changes.

The implementation should satisfy the acceptance criteria in `requirements.json` and align with the user journeys in `experience.json`.

## Decision and Assumption Policy

The scope and constraints above define the benchmark's starting intent.

The implementation agent may choose reasonable visual styling, product copy, catalog details, and technical implementation choices where the specification is silent.

It must not silently contradict an explicit requirement. When an important detail is ambiguous, it should either make a reasonable, documented assumption or identify the ambiguity for clarification.

The product model is the reference specification against which the generated application will be evaluated.
## Change Log

| ID | Request | Spec files touched |
| --- | --- | --- |
| CR-001 | "Add a return and refund page" | vision.md (scope), requirements.json (`returns-policy`), experience.json (`returns-policy` page) |
| CR-002 | "Add a subfooter with payment types accepted and contact us and help links" | vision.md (scope), requirements.json (`site-footer`), experience.json (global `footer`, `help` and `contact` pages) |
| CR-003 | "Online stores should occupy full width" | vision.md (scope), requirements.json (`full-width-layout`), experience.json (`design_intent.layout`) |
| CR-004 | "Cards should maximize for image over whitespace" | vision.md (scope), requirements.json (`image-first-cards`), experience.json (`design_intent.layout`) |
| CR-005 | "Just above the footer, add a similar section on the home page" (four-column icon strip from a reference store) | vision.md (scope), requirements.json (`home-trust-strip`), experience.json (`home` content) |

Note on CR-005: the reference strip made claims about a different business (years trading, customer counts). Only terms this store actually has are used: named makers, the 30-day returns policy, free shipping over $75 (a flat $6 below it, labelled as a demo estimate) and a two-business-day reply. The numbers are read from the same settings checkout uses.

Note on CR-002: the vision says checkout is simulated and no payment is collected. Accepted payment methods are therefore shown as the methods planned for launch, labelled as demo information, as text only (no card-brand artwork).
