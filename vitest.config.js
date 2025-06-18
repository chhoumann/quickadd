import { defineConfig } from "vitest/config";
// import { svelte } from "@sveltejs/vite-plugin-svelte";
// import sveltePreprocess from "svelte-preprocess";
import * as path from "path";
export default defineConfig({
    plugins: [
    // svelte({
    // 	hot: !process.env.VITEST,
    // 	preprocess: sveltePreprocess(),
    // }),
    ],
    resolve: {
        alias: {
            src: path.resolve("./src"),
        },
    },
    test: {
        include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        globals: true,
        environment: "jsdom",
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZXN0LmNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInZpdGVzdC5jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUM3Qyx5REFBeUQ7QUFDekQsb0RBQW9EO0FBQ3BELE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBRTdCLGVBQWUsWUFBWSxDQUFDO0lBQzNCLE9BQU8sRUFBRTtJQUNSLFdBQVc7SUFDWCw2QkFBNkI7SUFDN0IsbUNBQW1DO0lBQ25DLE1BQU07S0FDTjtJQUNELE9BQU8sRUFBRTtRQUNSLEtBQUssRUFBRTtZQUNOLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztTQUMxQjtLQUNEO0lBQ0QsSUFBSSxFQUFFO1FBQ0wsT0FBTyxFQUFFLENBQUMsc0RBQXNELENBQUM7UUFDakUsT0FBTyxFQUFFLElBQUk7UUFDYixXQUFXLEVBQUUsT0FBTztLQUNwQjtDQUNELENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlc3QvY29uZmlnXCI7XG4vLyBpbXBvcnQgeyBzdmVsdGUgfSBmcm9tIFwiQHN2ZWx0ZWpzL3ZpdGUtcGx1Z2luLXN2ZWx0ZVwiO1xuLy8gaW1wb3J0IHN2ZWx0ZVByZXByb2Nlc3MgZnJvbSBcInN2ZWx0ZS1wcmVwcm9jZXNzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG5cdHBsdWdpbnM6IFtcblx0XHQvLyBzdmVsdGUoe1xuXHRcdC8vIFx0aG90OiAhcHJvY2Vzcy5lbnYuVklURVNULFxuXHRcdC8vIFx0cHJlcHJvY2Vzczogc3ZlbHRlUHJlcHJvY2VzcygpLFxuXHRcdC8vIH0pLFxuXHRdLFxuXHRyZXNvbHZlOiB7XG5cdFx0YWxpYXM6IHtcblx0XHRcdHNyYzogcGF0aC5yZXNvbHZlKFwiLi9zcmNcIiksXG5cdFx0fSxcblx0fSxcblx0dGVzdDoge1xuXHRcdGluY2x1ZGU6IFtcInNyYy8qKi8qLnt0ZXN0LHNwZWN9LntqcyxtanMsY2pzLHRzLG10cyxjdHMsanN4LHRzeH1cIl0sXG5cdFx0Z2xvYmFsczogdHJ1ZSxcblx0XHRlbnZpcm9ubWVudDogXCJqc2RvbVwiLFxuXHR9LFxufSk7XG4iXX0=