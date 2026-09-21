return {
	"mfussenegger/nvim-lint",
	config = function()
		local lint = require("lint")

		lint.linters_by_ft = {
			lua = { "luacheck" },
			javascript = { "eslint_d" },
			javascriptreact = { "eslint_d" },
			typescript = { "eslint_d" },
			typescriptreact = { "eslint_d" },
			rust = { "clippy" },
		}

		local args = {
			"--format",
			"json",
			"--stdin",
			"--stdin-filename",
			function()
				return vim.api.nvim_buf_get_name(0)
			end,
		}

		local rules_dir = require("optional")("local.eslint")
		if rules_dir then
			vim.list_extend(args, { "--rulesdir", rules_dir })
		end

		lint.linters.eslint_d.args = args

		vim.api.nvim_create_autocmd({ "BufWritePost" }, {
			callback = function()
				require("lint").try_lint()
			end,
		})
	end,
}
