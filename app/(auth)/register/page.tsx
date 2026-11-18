import { Metadata } from "next";

import { getLoginMethods } from "@/ee/_shared/login-methods";

import RegisterClient from "./page-client";

const data = {
  description: "Signup to Papermark",
  title: "Sign up | Papermark",
  url: "/register",
};

// [fork] Read the sign-in providers from the runtime env, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.papermark.com"),
  title: data.title,
  description: data.description,
  openGraph: {
    title: data.title,
    description: data.description,
    url: data.url,
    siteName: "Papermark",
    images: [
      {
        url: "/_static/meta-image.png",
        width: 800,
        height: 600,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: data.title,
    description: data.description,
    creator: "@papermarkio",
    images: ["/_static/meta-image.png"],
  },
};

export default function RegisterPage() {
  return <RegisterClient methods={getLoginMethods()} />;
}
