import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
};

export default withWorkflow(nextConfig);
