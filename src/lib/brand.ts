/** The name the builder's assistant goes by in the chat. Change it here. */
export const AGENT_NAME = "Scout";

/** Where "Request access" on the sign-in page sends people. A mailto link, so no email service is needed. */
export const REQUEST_ACCESS_EMAIL = "rp2701.dev@gmail.com";
export const REQUEST_ACCESS_HREF = `mailto:${REQUEST_ACCESS_EMAIL}?subject=${encodeURIComponent("Appnomics builder access")}&body=${encodeURIComponent("Hi, I'd like to try the Appnomics builder.\n\nMy name:\nWhat I want to build:\n")}`;
