import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getGoogleAuthConfiguration } from "@/lib/auth/config";

const googleAuth = getGoogleAuthConfiguration();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleAuth.configured ? [Google] : [],
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  // Cloud Run terminates TLS at its trusted proxy and forwards the public host.
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      // Only accept accounts whose Google profile explicitly verifies its email.
      return (
        profile !== undefined &&
        "email_verified" in profile &&
        profile.email_verified === true
      );
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
