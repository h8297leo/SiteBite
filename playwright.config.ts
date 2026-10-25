import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',workers:1,timeout:240000,use:{baseURL:'http://localhost:3000',headless:true,channel:'msedge'},reporter:[['list'],['html',{open:'never'}]]});
