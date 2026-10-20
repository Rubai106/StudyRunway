import ChatWorkspace from "@/components/chat/ChatWorkspace";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { auth } from "@/auth";
import { getGoogleAuthConfiguration } from "@/lib/auth/config";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configuration = getGoogleAuthConfiguration();
  if (!configuration.configured) {
    return <GoogleSignIn configured={false} missing={configuration.missing} />;
  }

  const session = await auth();
  if (!session?.user) return <GoogleSignIn configured />;

  const storageScope = createHash("sha256")
    .update(session.user.id)
    .digest("hex")
    .slice(0, 32);
  return <ChatWorkspace storageScope={storageScope} />;
}
